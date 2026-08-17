"""
Noise floor and naive baselines (mission brief §4.4 and §4.5).

Answers two questions BEFORE anything is graded:

  1. What is the best MAPE/MAD any forecaster could possibly achieve against
     this generator?  Most of the variance in §6 is pure chance and is
     unforecastable by construction — grading Ope against zero error would be
     dishonest.

  2. What do the two naive baselines score?  If Ope cannot beat both, that is a
     headline finding.

The oracle used for the floor knows the weekday, the promo calendar and the
exact trend, but NOT the individual random rolls and NOT the one-off anomaly
days (nobody can forecast a burst water main).

Run:  python -m tests.simulation.noise_floor
"""
from __future__ import annotations

import json
import random
import statistics
from dataclasses import dataclass
from pathlib import Path

from tests.simulation.generator import (
    BASE_CUSTOMERS,
    DEFAULT_SEED,
    SERVING_HOURS,
    SUNDAY,
    DayOutcome,
    day_multiplier,
    hour_multiplier,
    open_days,
    simulate_year,
    trend_factor,
)

MC_SAMPLES = 200_000
_WD_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ── The oracle's conditional distribution ─────────────────────────────────────

@dataclass(frozen=True)
class UnitDist:
    """Distribution of the day total expressed as a multiple of BASE_CUSTOMERS."""
    mean: float
    median: float
    p10: float
    p90: float
    stdev: float


def _sample_unit(rng: random.Random, is_sunday: bool, promo: bool) -> float:
    """One draw of (day multiplier) x (mean hour multiplier).

    Uses a shared RNG stream rather than the generator's per-day seeded streams;
    statistically identical, and fast enough for 200k draws.
    """
    from datetime import date as _date
    probe = _date(2025, 8, 3) if is_sunday else _date(2025, 8, 4)   # Sun / Mon
    dm = day_multiplier(rng, probe, promo)
    hm = sum(hour_multiplier(rng, h, promo) for h in SERVING_HOURS) / len(SERVING_HOURS)
    return dm * hm


def unit_distributions(samples: int = MC_SAMPLES, seed: int = 20260817) -> dict[tuple[bool, bool], UnitDist]:
    """Monte-Carlo the four conditional distributions: (is_sunday, promo)."""
    out: dict[tuple[bool, bool], UnitDist] = {}
    for is_sunday in (False, True):
        for promo in (False, True):
            rng = random.Random((seed, is_sunday, promo).__hash__())
            xs = [_sample_unit(rng, is_sunday, promo) for _ in range(samples)]
            xs.sort()
            out[(is_sunday, promo)] = UnitDist(
                mean=statistics.fmean(xs),
                median=xs[len(xs) // 2],
                p10=xs[int(0.10 * len(xs))],
                p90=xs[int(0.90 * len(xs))],
                stdev=statistics.pstdev(xs),
            )
    return out


def oracle_predictions(
    outcomes: list[DayOutcome],
    dists: dict[tuple[bool, bool], UnitDist],
    use_median: bool = False,
) -> dict:
    """Best-possible point forecast per open day, given everything but the rolls."""
    preds = {}
    for o in outcomes:
        if not o.is_open:
            continue
        d = dists[(o.day.weekday() == SUNDAY, o.promo_active)]
        unit = d.median if use_median else d.mean
        preds[o.day] = BASE_CUSTOMERS * trend_factor(o.index) * unit
    return preds


# ── Metrics ───────────────────────────────────────────────────────────────────

def metrics(actuals: list[float], preds: list[float]) -> dict:
    if not actuals:
        return {"n": 0}
    errs = [a - p for a, p in zip(actuals, preds)]
    abs_errs = [abs(e) for e in errs]
    mad = statistics.fmean(abs_errs)
    mse = statistics.fmean(e * e for e in errs)
    mape = statistics.fmean(abs(e) / a for e, a in zip(errs, actuals) if a > 0) * 100
    rsfe = sum(errs)
    return {
        "n": len(actuals),
        "MAD": round(mad, 2),
        "MSE": round(mse, 1),
        "MAPE": round(mape, 2),
        "bias": round(rsfe / len(actuals), 2),
        "tracking_signal": round(rsfe / mad, 2) if mad > 0 else 0.0,
    }


# ── Naive baselines (§4.5) ────────────────────────────────────────────────────

def baseline_last_week(series: dict, day) -> float | None:
    """(a) last week's same weekday."""
    from datetime import timedelta
    return series.get(day - timedelta(days=7))


def baseline_trailing_4wk(series: dict, day) -> float | None:
    """(b) trailing 4-week mean for that weekday."""
    from datetime import timedelta
    vals = [series[day - timedelta(days=7 * k)] for k in (1, 2, 3, 4)
            if (day - timedelta(days=7 * k)) in series]
    return statistics.fmean(vals) if vals else None


# ── Report ────────────────────────────────────────────────────────────────────

def run(seed: str = DEFAULT_SEED, warmup_days: int = 28) -> dict:
    year = simulate_year(seed=seed, with_products=False)
    opens = open_days(year)

    # The observed series is what the app could ever see: open days the owner
    # actually logged.  Forgotten days are absent — never zero.
    observed = {o.day: float(o.customers) for o in opens if o.logged}

    dists = unit_distributions()
    oracle_mean = oracle_predictions(opens, dists, use_median=False)
    oracle_med = oracle_predictions(opens, dists, use_median=True)

    eval_days = [o for o in opens if o.logged and o.index >= warmup_days]
    eval_clean = [o for o in eval_days if not o.anomaly]

    def collect(days, predictor):
        a, p = [], []
        for o in days:
            v = predictor(o)
            if v is not None:
                a.append(float(o.customers))
                p.append(float(v))
        return a, p

    results: dict = {
        "seed": seed,
        "eval_from_day_index": warmup_days,
        "n_open_days": len(opens),
        "n_logged_open_days": len(observed),
        "n_eval_days_incl_anomalies": len(eval_days),
        "n_eval_days_excl_anomalies": len(eval_clean),
        "unit_distributions": {
            f"{'sunday' if s else 'weekday'}_{'promo' if p else 'normal'}": {
                "mean": round(d.mean, 4), "median": round(d.median, 4),
                "sd": round(d.stdev, 4), "p10": round(d.p10, 4), "p90": round(d.p90, 4),
                "expected_customers_at_base": round(BASE_CUSTOMERS * d.mean, 1),
            }
            for (s, p), d in dists.items()
        },
    }

    for label, days in (("excl_anomalies", eval_clean), ("incl_anomalies", eval_days)):
        block = {}
        a, p = collect(days, lambda o: oracle_mean[o.day])
        block["noise_floor_oracle_mean"] = metrics(a, p)
        a, p = collect(days, lambda o: oracle_med[o.day])
        block["noise_floor_oracle_median"] = metrics(a, p)
        a, p = collect(days, lambda o: baseline_last_week(observed, o.day))
        block["baseline_a_last_week_same_weekday"] = metrics(a, p)
        a, p = collect(days, lambda o: baseline_trailing_4wk(observed, o.day))
        block["baseline_b_trailing_4wk_weekday_mean"] = metrics(a, p)
        results[label] = block

    # Per-weekday floor and baselines (clean evaluation set).
    per_wd = {}
    for wd in range(7):
        days = [o for o in eval_clean if o.day.weekday() == wd]
        if not days:
            continue
        a, p = collect(days, lambda o: oracle_mean[o.day])
        f = metrics(a, p)
        a, p = collect(days, lambda o: baseline_last_week(observed, o.day))
        b1 = metrics(a, p)
        a, p = collect(days, lambda o: baseline_trailing_4wk(observed, o.day))
        b2 = metrics(a, p)
        per_wd[_WD_NAMES[wd]] = {
            "mean_customers": round(statistics.fmean(float(o.customers) for o in days), 1),
            "floor": f, "baseline_a": b1, "baseline_b": b2,
        }
    results["per_weekday_excl_anomalies"] = per_wd

    return results


def main() -> None:
    res = run()
    out = Path(__file__).resolve().parents[3] / "docs" / "simulation" / "noise_floor.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=2), encoding="utf-8")

    e = res["excl_anomalies"]
    print(f"seed                      : {res['seed']}")
    print(f"open days / logged        : {res['n_open_days']} / {res['n_logged_open_days']}")
    print(f"evaluated (excl anomalies): {res['n_eval_days_excl_anomalies']}\n")
    print("                                        MAPE      MAD")
    for k, label in (
        ("noise_floor_oracle_mean", "NOISE FLOOR (oracle, mean)   "),
        ("noise_floor_oracle_median", "NOISE FLOOR (oracle, median) "),
        ("baseline_a_last_week_same_weekday", "baseline a: last week same wd"),
        ("baseline_b_trailing_4wk_weekday_mean", "baseline b: trailing 4wk mean"),
    ):
        m = e[k]
        print(f"  {label}  {m['MAPE']:>6.2f}%  {m['MAD']:>7.2f}")
    print(f"\nwritten: {out}")


if __name__ == "__main__":
    main()

"""
Score what Ope actually predicted against what really happened.

Compares three things on exactly the same set of days:

  * **Ope**            — the prediction it made on the evening before (or N days
                         before, for longer horizons), read back from the log the
                         simulated owner kept.
  * **The noise floor** — the best a forecaster that knew the weekday, the promo
                         calendar and the exact trend could possibly do.
  * **Two naive baselines** — last week's same weekday, and the trailing 4-week
                         mean for that weekday.

Run:  python -m tests.simulation.score      (from backend/)
"""
from __future__ import annotations

import json
import statistics
from datetime import date, timedelta
from pathlib import Path

from tests.simulation.generator import (
    ANOMALY_DAYS,
    BASE_CUSTOMERS,
    SUNDAY,
    open_days,
    simulate_year,
    trend_factor,
)
from tests.simulation.noise_floor import metrics, unit_distributions

OUT_DIR = Path(__file__).resolve().parents[3] / "docs" / "simulation"
_WD = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def load_state() -> dict:
    return json.loads((OUT_DIR / "year_state.json").read_text(encoding="utf-8"))


def score(warmup_days: int = 28, horizon: int | None = 1) -> dict:
    """horizon=1 scores next-day predictions; horizon=None scores the freshest
    prediction Ope was showing for each date, whatever its horizon — which is
    what the owner actually reads, and the only way Sundays get scored at all
    (the shop is shut on Saturday, so nobody opens the app to see them)."""
    state = load_state()
    actuals = {date.fromisoformat(k): float(v) for k, v in state["actuals"].items()}

    year = {o.day: o for o in open_days(simulate_year(with_products=False))}
    dists = unit_distributions()

    # Ope's prediction for each target date at the requested horizon.  When it
    # forecast the same date more than once, the most recent one wins — that is
    # what the owner would actually have been looking at.
    ope_pred: dict[date, dict] = {}
    learning_days: list[str] = []
    for f in state["forecasts"]:
        if "target" not in f:
            if f.get("status") == "learning":
                learning_days.append(f["made_on"])
            continue
        if horizon is not None and f.get("horizon") != horizon:
            continue
        t = date.fromisoformat(f["target"])
        made = date.fromisoformat(f["made_on"])
        if t not in ope_pred or made > ope_pred[t]["made"]:
            ope_pred[t] = {"made": made, "p": float(f["predicted"]),
                           "lo": float(f["lo"]), "hi": float(f["hi"]),
                           "w": f.get("weights") or {}}

    def base_last_week(d: date) -> float | None:
        return actuals.get(d - timedelta(days=7))

    def base_4wk(d: date) -> float | None:
        vals = [actuals[d - timedelta(days=7 * k)] for k in (1, 2, 3, 4)
                if (d - timedelta(days=7 * k)) in actuals]
        return statistics.fmean(vals) if vals else None

    def oracle(d: date) -> float:
        o = year[d]
        u = dists[(d.weekday() == SUNDAY, o.promo_active)]
        return BASE_CUSTOMERS * trend_factor(o.index) * u.mean

    # Evaluation set: days Ope actually predicted, past the warm-up, excluding
    # the two one-off disasters the owner marked as flukes.
    eval_days = sorted(
        d for d in ope_pred
        if d in actuals and d in year
        and year[d].index >= warmup_days
        and d not in ANOMALY_DAYS
    )

    def collect(days, pred_fn):
        a, p = [], []
        for d in days:
            v = pred_fn(d)
            if v is not None:
                a.append(actuals[d])
                p.append(float(v))
        return a, p

    def block(days) -> dict:
        out = {}
        a, p = collect(days, lambda d: ope_pred[d]["p"])
        out["ope"] = metrics(a, p)
        a, p = collect(days, oracle)
        out["noise_floor"] = metrics(a, p)
        a, p = collect(days, base_last_week)
        out["baseline_a_last_week"] = metrics(a, p)
        a, p = collect(days, base_4wk)
        out["baseline_b_4wk_mean"] = metrics(a, p)
        return out

    res: dict = {
        "horizon_days": horizon,
        "warmup_days": warmup_days,
        "n_days_logged": len(actuals),
        "n_evaluated": len(eval_days),
        "n_learning_responses": len(learning_days),
        "first_forecast_on": min(
            (f["made_on"] for f in state["forecasts"]), default=None),
        "overall": block(eval_days),
    }

    # ── how it improved over time ────────────────────────────────────────────
    milestones = {}
    for label, upto in (("to_day_30", 30), ("to_day_60", 60), ("to_day_90", 90),
                        ("to_day_180", 180), ("to_day_365", 365)):
        days = [d for d in eval_days if year[d].index < upto]
        if len(days) >= 10:
            milestones[label] = block(days)
    res["milestones"] = milestones

    # ── per weekday ──────────────────────────────────────────────────────────
    res["per_weekday"] = {
        _WD[wd]: dict(block([d for d in eval_days if d.weekday() == wd]),
                      mean_customers=round(statistics.fmean(
                          actuals[d] for d in eval_days if d.weekday() == wd), 1))
        for wd in range(7)
        if len([d for d in eval_days if d.weekday() == wd]) >= 5
    }

    # ── promo vs normal days ─────────────────────────────────────────────────
    res["promo_days"] = block([d for d in eval_days if year[d].promo_active])
    res["normal_days"] = block([d for d in eval_days if not year[d].promo_active])

    # ── interval honesty: how often did the actual land inside the band? ─────
    inside = sum(1 for d in eval_days
                 if ope_pred[d]["lo"] <= actuals[d] <= ope_pred[d]["hi"])
    widths = [ope_pred[d]["hi"] - ope_pred[d]["lo"] for d in eval_days]
    res["interval"] = {
        "coverage_pct": round(100 * inside / len(eval_days), 1) if eval_days else None,
        "median_width_customers": round(statistics.median(widths), 1) if widths else None,
        "median_width_pct_of_forecast": round(statistics.median(
            (ope_pred[d]["hi"] - ope_pred[d]["lo"]) / max(ope_pred[d]["p"], 1) * 100
            for d in eval_days), 1) if eval_days else None,
    }

    # ── which models the ensemble leaned on ──────────────────────────────────
    tot: dict[str, float] = {}
    for d in eval_days:
        for m, w in ope_pred[d]["w"].items():
            tot[m] = tot.get(m, 0.0) + float(w)
    n = max(len(eval_days), 1)
    res["mean_model_weights"] = {m: round(v / n, 3) for m, v in
                                 sorted(tot.items(), key=lambda kv: -kv[1])}

    return res


def report(res: dict) -> str:
    L = []
    o = res["overall"]
    L.append(f"evaluated {res['n_evaluated']} days at horizon "
             f"{res['horizon_days']} (day-{res['warmup_days']}+ , flukes excluded)")
    L.append("")
    L.append(f"{'':<34}{'MAPE':>8}{'MAD':>9}{'bias':>9}")
    for key, label in (("ope", "OPE"),
                       ("noise_floor", "noise floor (best possible)"),
                       ("baseline_a_last_week", "baseline a: last week same wd"),
                       ("baseline_b_4wk_mean", "baseline b: trailing 4wk mean")):
        m = o[key]
        L.append(f"  {label:<32}{m['MAPE']:>7.2f}%{m['MAD']:>9.1f}{m['bias']:>9.1f}")
    beats_a = o["ope"]["MAPE"] < o["baseline_a_last_week"]["MAPE"]
    beats_b = o["ope"]["MAPE"] < o["baseline_b_4wk_mean"]["MAPE"]
    gap = o["ope"]["MAPE"] - o["noise_floor"]["MAPE"]
    L.append("")
    L.append(f"  beats baseline a: {'YES' if beats_a else 'NO'}   "
             f"beats baseline b: {'YES' if beats_b else 'NO'}   "
             f"above the floor by {gap:+.2f} points")

    if res["milestones"]:
        L.append("")
        L.append("improvement over time (MAPE):")
        L.append(f"  {'window':<14}{'Ope':>8}{'floor':>8}{'base b':>9}{'n':>6}")
        for k, m in res["milestones"].items():
            L.append(f"  {k:<14}{m['ope']['MAPE']:>7.2f}%{m['noise_floor']['MAPE']:>7.2f}%"
                     f"{m['baseline_b_4wk_mean']['MAPE']:>8.2f}%{m['ope']['n']:>6}")

    L.append("")
    L.append("per weekday (MAPE):")
    L.append(f"  {'day':<11}{'mean':>7}{'Ope':>8}{'floor':>8}{'base b':>9}{'n':>5}")
    for wd, m in res["per_weekday"].items():
        L.append(f"  {wd:<11}{m['mean_customers']:>7.0f}{m['ope']['MAPE']:>7.2f}%"
                 f"{m['noise_floor']['MAPE']:>7.2f}%{m['baseline_b_4wk_mean']['MAPE']:>8.2f}%"
                 f"{m['ope']['n']:>5}")

    L.append("")
    p, nrm = res["promo_days"], res["normal_days"]
    L.append(f"promo days   Ope {p['ope']['MAPE']:.2f}%  floor {p['noise_floor']['MAPE']:.2f}%  (n={p['ope']['n']})")
    L.append(f"normal days  Ope {nrm['ope']['MAPE']:.2f}%  floor {nrm['noise_floor']['MAPE']:.2f}%  (n={nrm['ope']['n']})")

    iv = res["interval"]
    L.append("")
    L.append(f"prediction interval: actual landed inside {iv['coverage_pct']}% of the time; "
             f"typical width {iv['median_width_customers']} customers "
             f"({iv['median_width_pct_of_forecast']}% of the forecast)")
    L.append(f"mean model weights: {res['mean_model_weights']}")
    return "\n".join(L)


def main() -> None:
    out = {}
    for label, h in (("freshest", None), ("next_day", 1)):
        res = score(horizon=h)
        out[label] = res
        print(f"===== {label.upper().replace('_', ' ')} =====")
        print(report(res))
        print()
    (OUT_DIR / "score.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"written: {OUT_DIR / 'score.json'}")


if __name__ == "__main__":
    main()

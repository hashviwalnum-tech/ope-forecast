"""
Per-product and per-hour accuracy (mission brief §9.2).

Per product: the unit forecasts Ope showed for each product, scored against what
really sold, with the same two naive baselines for comparison.

Per hour: the busy-hours profile Ope reports, against the true hourly arrivals.
That one is an *estimate* of the usual shape rather than a next-day forecast, so
it is scored as such and labelled that way.

Run AFTER run_year:  python -m tests.simulation.score_detail
"""
from __future__ import annotations

import json
import statistics
from datetime import date, timedelta
from pathlib import Path

from tests.simulation.generator import (
    ANOMALY_DAYS,
    SERVING_HOURS,
    open_days,
    simulate_year,
)
from tests.simulation.menu import BY_KEY
from tests.simulation.noise_floor import metrics
from tests.simulation.score import load_state

OUT_DIR = Path(__file__).resolve().parents[3] / "docs" / "simulation"


def per_product(warmup_days: int = 28) -> dict:
    state = load_state()
    pf = state.get("product_forecasts") or []
    if not pf:
        return {"status": "no product forecasts were logged"}

    actuals = {date.fromisoformat(k): v for k, v in state["product_actuals"].items()}
    year = {o.day: o for o in open_days(simulate_year(with_products=False))}

    # Freshest prediction per (product, date).
    best: dict[tuple[str, date], tuple[date, float]] = {}
    for f in pf:
        if not f.get("product"):
            continue
        t = date.fromisoformat(f["target"])
        m = date.fromisoformat(f["made_on"])
        k = (f["product"], t)
        if k not in best or m > best[k][0]:
            best[k] = (m, float(f["predicted"]))

    out: dict = {}
    for key in sorted({k for k, _ in best}):
        days = sorted(
            d for (p, d) in best
            if p == key and d in actuals and d in year
            and year[d].index >= warmup_days and d not in ANOMALY_DAYS
        )
        a, pr, b1, b2 = [], [], [], []
        for d in days:
            act = actuals[d].get(key, 0.0)
            if act <= 0:
                continue
            a.append(act)
            pr.append(best[(key, d)][1])
            lw = actuals.get(d - timedelta(days=7), {}).get(key)
            b1.append(lw if lw is not None else float("nan"))
            hist = [actuals[d - timedelta(days=7 * k2)].get(key)
                    for k2 in (1, 2, 3, 4)
                    if (d - timedelta(days=7 * k2)) in actuals]
            hist = [h for h in hist if h is not None]
            b2.append(statistics.fmean(hist) if hist else float("nan"))
        if len(a) < 20:
            continue

        def clean(pred):
            aa, pp = [], []
            for x, y in zip(a, pred):
                if y == y:      # not NaN
                    aa.append(x)
                    pp.append(y)
            return aa, pp

        item = BY_KEY.get(key)
        out[key] = {
            "name": item.name if item else key,
            "unit_mode": item.unit_mode if item else "whole",
            "product_type": item.product_type if item else "stocked",
            "mean_units_per_day": round(statistics.fmean(a), 1),
            "ope": metrics(a, pr),
            "baseline_a_last_week": metrics(*clean(b1)),
            "baseline_b_4wk_mean": metrics(*clean(b2)),
        }
    return out


def per_hour() -> dict:
    """How well the busy-hours profile matches the real hourly arrivals."""
    from tests.simulation.harness import bootstrap, teardown
    from tests.simulation.generator import YEAR_DAYS, YEAR_START

    ope, _app, _clock = bootstrap(fresh=False)
    ope.use_business(1, tz="America/New_York")
    ope.at_local(YEAR_START + timedelta(days=YEAR_DAYS), 18, 0)
    reported = ope.get("/hourly-analytics")
    teardown(ope)
    if reported.get("status") != "ok":
        return {"status": reported.get("status")}

    year = [o for o in open_days(simulate_year(with_products=False))
            if o.logged and not o.anomaly]
    true_by_hour = {
        h: statistics.fmean(next(x.customers for x in o.hours if x.hour == h) for o in year)
        for h in SERVING_HOURS
    }

    rows = {}
    a, p = [], []
    for slot in reported["hours"]:
        h = slot["hour"]
        if h not in true_by_hour:
            continue
        rows[h] = {
            "reported": slot["avg_taps"],
            "true_mean": round(true_by_hour[h], 1),
            "error_pct": round((slot["avg_taps"] - true_by_hour[h]) / true_by_hour[h] * 100, 2),
            "recommended_staff": slot["recommended_staff"],
            "expected_wait_minutes": slot["expected_wait_minutes"],
        }
        a.append(true_by_hour[h])
        p.append(float(slot["avg_taps"]))
    return {"status": "ok", "hours": rows, "overall": metrics(a, p),
            "note": "this is the usual-shape estimate, not a next-day forecast"}


def main() -> None:
    res = {"per_product": per_product(), "per_hour": per_hour()}
    (OUT_DIR / "score_detail.json").write_text(json.dumps(res, indent=1), encoding="utf-8")

    pp = res["per_product"]
    if isinstance(pp, dict) and "status" not in pp:
        print("PER PRODUCT (freshest forecast, day-28+, flukes excluded)")
        print(f"  {'product':<24}{'mean/day':>9}{'Ope':>9}{'base a':>9}{'base b':>9}{'n':>6}")
        for k, v in sorted(pp.items(), key=lambda kv: -kv[1]["mean_units_per_day"]):
            print(f"  {v['name']:<24}{v['mean_units_per_day']:>9}"
                  f"{v['ope']['MAPE']:>8.2f}%{v['baseline_a_last_week']['MAPE']:>8.2f}%"
                  f"{v['baseline_b_4wk_mean']['MAPE']:>8.2f}%{v['ope']['n']:>6}")
    else:
        print("PER PRODUCT:", pp)

    ph = res["per_hour"]
    if ph.get("status") == "ok":
        print("\nPER HOUR (usual-shape estimate vs the real hourly arrivals)")
        print(f"  {'hour':>5}{'Ope says':>10}{'truth':>9}{'error':>9}{'staff':>7}{'wait':>7}")
        for h, v in sorted(ph["hours"].items(), key=lambda kv: int(kv[0])):
            print(f"  {h:>5}{v['reported']:>10}{v['true_mean']:>9}"
                  f"{v['error_pct']:>8.2f}%{v['recommended_staff']:>7}{v['expected_wait_minutes']:>7}")
        print(f"  overall MAPE {ph['overall']['MAPE']}%")
    else:
        print("\nPER HOUR:", ph)
    print(f"\nwritten: {OUT_DIR / 'score_detail.json'}")


if __name__ == "__main__":
    main()

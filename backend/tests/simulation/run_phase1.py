"""
Phase 1 — the first 14 simulated days, run slowly and checked carefully.

The owner taps every sale live for these two weeks (the live-capture path), so
this phase proves: tap logging, the automatic tap-day rollup, hourly bucketing
inside opening hours, and — most importantly — what a brand-new owner actually
SEES while Ope has almost no data.

Run:  python -m tests.simulation.run_phase1        (from backend/)
"""
from __future__ import annotations

import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from tests.simulation.generator import (
    CLOSED_WEEKDAY,
    SERVING_HOURS,
    YEAR_START,
    simulate_day,
)
from tests.simulation.harness import bootstrap, teardown
from tests.simulation.owner import OUT_DIR, SimulatedOwner

DAYS = 14


def main() -> int:
    ope, app, clock = bootstrap(fresh=True)
    own = SimulatedOwner(ope, verbose=True)
    log: list[dict] = []

    print("=" * 74)
    print("PHASE 1 — first 14 simulated days (owner taps every sale)")
    print("=" * 74)

    own.onboard(YEAR_START)
    print(f"onboarded: business {own.s.business_id}, {len(own.s.product_ids)} products")
    started = time.time()

    for i in range(DAYS):
        day = YEAR_START + timedelta(days=i)
        o = simulate_day(day, i)

        if not o.is_open:
            print(f"day {i+1:>2} {day} {day.strftime('%a')}  CLOSED")
            # An owner still opens the app on a day off; nothing should break.
            ope.at_local(day, 12, 0)
            own.read_forecast(day)
            continue

        own.declare_promos_starting(day)
        own.tap_through_day(o)

        # The next morning the tap-only day should have rolled into past days.
        ope.at_local(day + timedelta(days=1), 8, 0)
        recs = ope.get("/day-records")
        stored = next((r for r in recs if r["date"] == day.isoformat()), None)

        row = {
            "day": day.isoformat(),
            "weekday": day.strftime("%a"),
            "actual": o.customers,
            "stored": stored["customers"] if stored else None,
            "promo": o.promos,
        }
        if stored is None:
            own.note(day, "tap rollup", "tap-only day never became a day record")
        elif stored["customers"] != o.customers:
            own.note(day, "tap rollup",
                     f"tapped {o.customers} customers, day record says {stored['customers']}")

        own.s.actuals[day.isoformat()] = o.customers

        # Evening: what does the owner actually see?
        own.read_forecast(day)
        own.review_flags(day)
        latest = [f for f in own.s.forecasts if f.get("made_on") == day.isoformat()]
        row["forecast_status"] = (
            "ok" if latest and "predicted" in latest[0]
            else (latest[0].get("status") if latest else "none")
        )
        row["tomorrow"] = next((f["predicted"] for f in latest if f.get("horizon") == 1), None)
        log.append(row)

        print(f"day {i+1:>2} {day} {row['weekday']}  actual={o.customers:>4}"
              f"  stored={row['stored']}  forecast={row['forecast_status']}"
              f"  tomorrow={row['tomorrow']}"
              + (f"  [{', '.join(o.promos)}]" if o.promos else ""))

    print(f"\nran in {time.time() - started:.0f}s")

    # ── what the owner sees on day 14 ────────────────────────────────────────
    last = YEAR_START + timedelta(days=DAYS - 1)
    ope.at_local(last, 18, 0)
    checks = inspect(ope, own, last)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "phase1.json").write_text(json.dumps({
        "days": log,
        "checks": checks,
        "issues": [i.as_dict() for i in own.s.issues],
        "forecasts": own.s.forecasts,
    }, indent=1, default=str), encoding="utf-8")

    print("\n" + "=" * 74)
    print(f"ISSUES RECORDED: {len(own.s.issues)}")
    for i in own.s.issues:
        print(f"  {i.day}  {i.where}: {i.detail[:150]}")
    print("=" * 74)
    teardown(ope)
    return 0


def inspect(ope, own: SimulatedOwner, day: date) -> dict:
    """Read every surface a two-week-old account would show, and report honestly."""
    out: dict = {}
    print("\n--- what the owner sees after two weeks ---")

    for label, path in (
        ("forecast", "/forecast"),
        ("accuracy", "/accuracy"),
        ("ordering", "/ordering"),
        ("weekday averages", "/weekday-averages"),
        ("hourly analytics", "/hourly-analytics"),
        ("hourly by weekday", "/hourly-by-weekday"),
        ("product forecast", "/product-forecast"),
        ("insights", "/insights"),
        ("monthly summary", "/monthly-summary"),
        ("lift", "/lift"),
        ("forecast history", "/forecast-history"),
    ):
        r = ope.try_("GET", path)
        if r.status_code != 200:
            own.note(day, label, f"GET {path} -> {r.status_code}: {r.text[:200]}")
            out[label] = {"http": r.status_code}
            print(f"  {label:<20} HTTP {r.status_code}")
            continue
        body = r.json()
        out[label] = body
        status = body.get("status") if isinstance(body, dict) else None
        print(f"  {label:<20} {status or 'ok'}"
              + (f"  — {body.get('message', '')[:80]}" if isinstance(body, dict) and body.get("message") else ""))

    # Hourly sanity: a 09:00–17:00 shop must never report activity outside those hours.
    ha = out.get("hourly analytics") or {}
    hours = [h.get("hour") for h in (ha.get("hours") or [])]
    stray = [h for h in hours if h is not None and h not in SERVING_HOURS]
    if stray:
        own.note(day, "hourly analytics",
                 f"reports activity in closed hours {sorted(set(stray))} for a 9-17 business")
    out["stray_hours"] = sorted(set(stray))

    return out


if __name__ == "__main__":
    sys.exit(main())

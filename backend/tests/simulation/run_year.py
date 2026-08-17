"""
Phases 2 and 3 — drive the simulated year and score every forecast.

Usage (from backend/):
    python -m tests.simulation.run_year --to 90            # phase 2
    python -m tests.simulation.run_year --to 365 --resume  # phase 3

Day shape, in the business's own local time:
  * a handful of sampled days are TAPPED live, the rest are logged end-of-day
    with hourly counts first (what a 500-cover restaurant actually does);
  * ads and events are tagged in the app on the day they start;
  * the owner reviews whatever Ope flagged as unusual;
  * every evening the owner reads the 7-day forecast, and every prediction is
    written down with the date it was made so it can be scored later against
    what really happened.

Nothing here tells the app anything the app could not legitimately observe.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from tests.simulation.generator import (
    ANOMALY_DAYS,
    LATE_LOGGED_DAYS,
    YEAR_START,
    simulate_day,
)
from tests.simulation.harness import bootstrap, teardown
from tests.simulation.owner import OUT_DIR, SimulatedOwner

# Days on which the owner taps live rather than typing end-of-day totals.
# Kept sparse on purpose: tapping 500 sales a day is not something a busy
# restaurant does, and each tap is a separate API call.
TAP_DAYS = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 40, 41, 120, 200, 201, 300}

STATE_FILE = OUT_DIR / "year_state.json"


def run(start_index: int, end_index: int, resume: bool, verbose: bool) -> dict:
    ope, app, clock = bootstrap(fresh=not resume)
    own = SimulatedOwner(ope, verbose=verbose)

    if resume and STATE_FILE.exists():
        saved = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        own.s.business_id = saved["business_id"]
        own.s.product_ids = saved["product_ids"]
        own.s.actuals = saved["actuals"]
        own.s.forecasts = saved["forecasts"]
        own.s.promos_created = saved["promos_created"]
        ope.use_business(saved["business_id"], tz="America/New_York")
        print(f"resumed: business {saved['business_id']}, "
              f"{len(saved['actuals'])} days already logged")
    else:
        own.onboard(YEAR_START)
        print(f"onboarded: business {own.s.business_id}, {len(own.s.product_ids)} products")

    started = time.time()
    late_queue: list = []
    rng = random.Random(f'owner-behaviour|{start_index}')

    for i in range(start_index, end_index):
        day = YEAR_START + timedelta(days=i)
        o = simulate_day(day, i)

        if not o.is_open:
            continue

        own.declare_promos_starting(day)

        # Days the owner simply forgot — nothing is logged, and the app must
        # treat the day as ABSENT, never as zero customers.
        if not o.logged:
            if verbose:
                print(f"  {day} — owner forgot to log this day")
            continue

        own.s.actuals[day.isoformat()] = o.customers

        delay = LATE_LOGGED_DAYS.get(day, 0)
        if delay:
            late_queue.append((day + timedelta(days=delay), o))
        elif i in TAP_DAYS:
            own.tap_through_day(o)
            ope.at_local(day, 17, 5)
            ope.get("/day-records")           # the roll-up the owner would trigger
        else:
            own.log_end_of_day(o)

        # Anything that was owed and is now due gets caught up.
        for due, pending in list(late_queue):
            if due <= day:
                own.log_end_of_day(pending, on_day=day)
                late_queue.remove((due, pending))

        own.ensure_regulars(day)
        own.record_regular_visits(day, rng)
        if i == 45:
            own.declare_recurring_pattern(day)
        own.review_flags(day)
        own.place_orders(day)
        own.read_forecast(day)

        if verbose and i % 10 == 0:
            print(f"  day {i:>3} {day} {day.strftime('%a')}  {o.customers:>4}"
                  + (f"  [{', '.join(o.promos)}]" if o.promos else ""))

    elapsed = time.time() - started
    print(f"ran days {start_index}-{end_index} in {elapsed:.0f}s "
          f"({len(own.s.issues)} issues)")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({
        "business_id": own.s.business_id,
        "product_ids": own.s.product_ids,
        "actuals": own.s.actuals,
        "forecasts": own.s.forecasts,
        "promos_created": own.s.promos_created,
        "issues": [x.as_dict() for x in own.s.issues],
        "last_index": end_index,
    }), encoding="utf-8")

    teardown(ope)
    return {"issues": own.s.issues, "n_forecasts": len(own.s.forecasts)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", type=int, default=0)
    ap.add_argument("--to", dest="end", type=int, default=90)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    start = a.start
    if a.resume and STATE_FILE.exists() and start == 0:
        start = json.loads(STATE_FILE.read_text(encoding="utf-8"))["last_index"]

    res = run(start, a.end, a.resume, verbose=not a.quiet)
    if res["issues"]:
        print(f"\nISSUES ({len(res['issues'])}):")
        seen: dict[str, int] = {}
        for x in res["issues"]:
            seen[x.where] = seen.get(x.where, 0) + 1
        for where, n in sorted(seen.items(), key=lambda kv: -kv[1]):
            example = next(x for x in res["issues"] if x.where == where)
            print(f"  x{n:<4} {where}: {example.detail[:160]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

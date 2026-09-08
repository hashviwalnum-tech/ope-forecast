"""What the startup timezone backfill actually decided, per business.

`app/api/timezone_backfill.py` runs on every boot and logs one line per
business, but Render's log stream rolls over and the decision itself is only
visible in the database afterwards. This reads it back.

The backfill records its reasoning in `settings.timezone_backfill` whenever it
fills a zone in, so each row can say not just *what* zone a business has but
*where it came from* — inferred at signup by the client, inferred later from
currency or trading hours, or set by the owner in Settings. A business with no
zone is one the backfill deliberately refused to guess at: it is shown the
"timezone not set" notice in the app, and its dates fall back to UTC until
someone answers.

    # Connects to DATABASE_URL and prints a table.
    python -m tests.deployment.report_timezones

    # Prints SQL to paste into the Supabase editor instead.
    python -m tests.deployment.report_timezones --sql

Read-only either way. It never writes.
"""
from __future__ import annotations

import argparse
import os
import sys

SQL = """\
-- What timezone each business has, and where it came from.
-- A NULL zone is one the backfill refused to guess: that business sees the
-- "timezone not set" notice and falls back to UTC.
SELECT
  b.id,
  b.name,
  b.settings ->> 'timezone'                        AS timezone,
  b.settings -> 'timezone_backfill' ->> 'source'   AS decided_by,
  b.settings -> 'timezone_backfill' ->> 'reason'   AS reasoning,
  b.settings ->> 'currency'                        AS currency,
  b.settings ->> 'opening_hour'                    AS opens,
  b.settings ->> 'closing_hour'                    AS closes,
  (SELECT count(*) FROM sale_events s WHERE s.business_id = b.id) AS sale_events
FROM businesses b
ORDER BY (b.settings ->> 'timezone') IS NULL DESC, b.id;
"""


def run() -> int:
    from app.api.timezone_backfill import UNRESOLVED_KEY
    from app.db import SessionLocal
    from app.models import Business, SaleEvent

    db = SessionLocal()
    try:
        rows = db.query(Business).order_by(Business.id).all()
        if not rows:
            print("No businesses in this database.")
            return 0

        unset = []
        print(f"{'id':>4}  {'name':<28} {'timezone':<20} decided by")
        print("-" * 86)
        for b in rows:
            settings = b.settings or {}
            zone = settings.get("timezone")
            trace = settings.get(UNRESOLVED_KEY) or {}
            source = trace.get("source") or ("set directly" if zone else "-")
            print(f"{b.id:>4}  {b.name[:28]:<28} {(zone or '(not set)'):<20} {source}")
            if trace.get("reason"):
                print(f"{'':>6}{trace['reason']}")
            if not zone:
                unset.append(b)

        print()
        print(f"{len(rows) - len(unset)} of {len(rows)} business(es) have a timezone.")

        if unset:
            print()
            print("Left unset — these fall back to UTC and are shown the notice:")
            for b in unset:
                events = (db.query(SaleEvent)
                            .filter(SaleEvent.business_id == b.id).count())
                settings = b.settings or {}
                why = []
                if not settings.get("currency"):
                    why.append("no currency")
                if events == 0:
                    why.append("no sale events to read trading hours from")
                elif not (settings.get("opening_hour") or settings.get("closing_hour")):
                    why.append(f"{events} sale event(s), hours not conclusive")
                print(f"  {b.id}: {b.name} - " + ("; ".join(why) or "inference inconclusive"))
            print()
            print("The owner can settle it in Settings; the app already asks them.")
    finally:
        db.close()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sql", action="store_true",
                    help="print SQL instead of connecting")
    args = ap.parse_args()

    if args.sql:
        print(SQL)
        return 0
    if not os.environ.get("DATABASE_URL"):
        print("Set DATABASE_URL to the database you want to read, or use --sql.",
              file=sys.stderr)
        return 2
    return run()


if __name__ == "__main__":
    raise SystemExit(main())

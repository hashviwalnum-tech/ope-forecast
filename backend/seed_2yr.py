"""
Two-year realistic spa data seed.

Generates ~2 years of open-day records for business_id=1 ("the spa").
Open days: Mon–Fri + Sunday (no Saturday).
Opening hours: 09:00–19:00 Israel local time.
Timestamps stored as UTC (Israel is UTC+3 DST / UTC+2 standard).

For Supabase cloud DB: use insert_events.py (REST API, no DB password needed).
This script requires DATABASE_URL set to a Postgres URL in backend/.env.

Prints a summary at the end.
"""
from __future__ import annotations

import random
from datetime import date, datetime, timedelta

from sqlalchemy import text
from app.db import engine

random.seed(42)

# ── Config ────────────────────────────────────────────────────────────────────
BUSINESS_ID = 1
PRODUCT_ID = 2          # "yoav" filings
START_DATE = date(2024, 6, 17)
END_DATE   = date(2026, 6, 17)

# Open weekdays (0=Mon … 6=Sun); Saturday (5) closed
OPEN_DAYS = {0, 1, 2, 3, 4, 6}

# Base customers per weekday for a small Israeli spa
BASE_CUSTOMERS: dict[int, int] = {
    0: 22,   # Monday   — quietest
    1: 26,   # Tuesday
    2: 28,   # Wednesday
    3: 32,   # Thursday
    4: 45,   # Friday   — pre-Shabbat rush, busiest
    6: 36,   # Sunday   — first day of Israeli work week
}

# Monthly seasonal multiplier (1.0 = neutral)
# Summer + December high; Jan–Feb slow
SEASONAL: dict[int, float] = {
    1: 0.72,  # January   — post-holiday lull
    2: 0.75,  # February
    3: 0.85,  # March
    4: 0.95,  # April
    5: 1.00,  # May       — baseline
    6: 1.05,  # June
    7: 1.22,  # July      — summer peak
    8: 1.18,  # August
    9: 1.02,  # September
   10: 0.95,  # October
   11: 0.88,  # November
   12: 1.18,  # December  — Chanukah / holiday season
}

NOISE       = 0.15   # ±15% daily random noise
PRODUCT_PCT = 0.85   # ~85% of customers get a "yoav" service each day
YOY_GROWTH  = 0.10   # Year-2 is 10% higher than Year-1

# Hourly arrival weights for 09:00–18:00 (10 one-hour slots)
# Peaks at 11:00 and 16:00
HOUR_START = 9
HOUR_SLOTS = list(range(9, 19))          # [9, 10, ..., 18]
HOUR_WEIGHTS = [5, 8, 14, 12, 8, 6, 9, 15, 12, 11]  # sum = 100


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_dst(d: date) -> bool:
    """Israel DST: last Sunday of March → last Sunday of October."""
    def _last_sun(year: int, month: int) -> date:
        # Start from the last day of the month and go back to Sunday
        if month == 12:
            first_next = date(year + 1, 1, 1)
        else:
            first_next = date(year, month + 1, 1)
        last_day = first_next - timedelta(days=1)
        offset = last_day.weekday() + 1  # days past Sunday (Sun=6 in isoweekday logic)
        # weekday(): Mon=0 … Sun=6; Sunday = 6
        days_since_sun = (last_day.weekday() + 1) % 7
        return last_day - timedelta(days=days_since_sun)

    dst_start = _last_sun(d.year, 3)   # last Sunday of March
    dst_end   = _last_sun(d.year, 10)  # last Sunday of October
    return dst_start <= d < dst_end


def _utc_offset(d: date) -> int:
    return 3 if _is_dst(d) else 2


def _local_to_utc(d: date, hour: int, minute: int) -> datetime:
    local_dt = datetime(d.year, d.month, d.day, hour, minute)
    return local_dt - timedelta(hours=_utc_offset(d))


def _pick_hour() -> int:
    r = random.random() * sum(HOUR_WEIGHTS)
    cumul = 0.0
    for h, w in zip(HOUR_SLOTS, HOUR_WEIGHTS):
        cumul += w
        if r < cumul:
            return h
    return HOUR_SLOTS[-1]


def _year_mult(d: date) -> float:
    """Year-1 = 1.0; Year-2 (from June 17 2025) = 1.0 + YOY_GROWTH."""
    return 1.0 + YOY_GROWTH if d >= date(2025, 6, 17) else 1.0


# ── Data generation ───────────────────────────────────────────────────────────

def generate():
    day_rows:   list[dict] = []
    srec_rows:  list[dict] = []
    event_rows: list[dict] = []

    cur = START_DATE
    while cur <= END_DATE:
        if cur.weekday() in OPEN_DAYS:
            wday  = cur.weekday()
            base  = BASE_CUSTOMERS[wday]
            mult  = SEASONAL[cur.month] * _year_mult(cur)
            noise = 1 + random.uniform(-NOISE, NOISE)
            customers = max(5, round(base * mult * noise))

            day_rows.append({"date": cur.isoformat(), "customers": customers})

            # Daily product total
            prod_noise = random.uniform(-0.05, 0.05)
            units = max(0, round(customers * (PRODUCT_PCT + prod_noise)))
            srec_rows.append({"units_sold": units})

            # Individual sale events — one per customer
            # First `units` events carry product_id; rest are customer-only taps
            has_product = [True] * units + [False] * (customers - units)
            random.shuffle(has_product)

            for with_prod in has_product:
                h = _pick_hour()
                m = random.randint(0, 59)
                utc_ts = _local_to_utc(cur, h, m)
                event_rows.append({
                    "ts":   utc_ts.strftime("%Y-%m-%d %H:%M:%S"),
                    "pid":  PRODUCT_ID if with_prod else None,
                    "qty":  1.0,
                })

        cur += timedelta(days=1)

    return day_rows, srec_rows, event_rows


# ── DB writes ─────────────────────────────────────────────────────────────────

def run() -> None:
    day_rows, srec_rows, event_rows = generate()

    with engine.begin() as conn:
        # ── Wipe existing data for this business ─────────────────────────────
        conn.execute(text(
            "DELETE FROM sale_events   WHERE business_id = :bid"
        ), {"bid": BUSINESS_ID})
        conn.execute(text(
            "DELETE FROM forecast_runs WHERE business_id = :bid"
        ), {"bid": BUSINESS_ID})
        conn.execute(text(
            "DELETE FROM tuner_logs    WHERE business_id = :bid"
        ), {"bid": BUSINESS_ID})

        # sale_records FK → day_records; delete via join
        conn.execute(text("""
            DELETE FROM sale_records
            WHERE day_record_id IN (
                SELECT id FROM day_records WHERE business_id = :bid
            )
        """), {"bid": BUSINESS_ID})
        conn.execute(text(
            "DELETE FROM day_records WHERE business_id = :bid"
        ), {"bid": BUSINESS_ID})

        # ── Insert day_records ────────────────────────────────────────────────
        dr_ids: list[int] = []
        for row in day_rows:
            result = conn.execute(text("""
                INSERT INTO day_records (business_id, date, customers)
                VALUES (:bid, :date, :customers)
                RETURNING id
            """), {"bid": BUSINESS_ID, "date": row["date"], "customers": row["customers"]})
            dr_ids.append(result.scalar_one())

        # ── Insert sale_records ───────────────────────────────────────────────
        for dr_id, sr in zip(dr_ids, srec_rows):
            conn.execute(text("""
                INSERT INTO sale_records (day_record_id, product_id, units_sold)
                VALUES (:drid, :pid, :units)
            """), {"drid": dr_id, "pid": PRODUCT_ID, "units": float(sr["units_sold"])})

        # ── Insert sale_events in batches of 500 ─────────────────────────────
        batch_size = 500
        for i in range(0, len(event_rows), batch_size):
            batch = event_rows[i : i + batch_size]
            conn.execute(
                text("""
                    INSERT INTO sale_events (business_id, product_id, timestamp, quantity)
                    SELECT
                        b.bid,
                        b.pid,
                        b.ts::timestamptz,
                        b.qty
                    FROM unnest(
                        :bids ::int[],
                        :pids ::int[],
                        :tss  ::text[],
                        :qtys ::float[]
                    ) AS b(bid, pid, ts, qty)
                """),
                {
                    "bids": [BUSINESS_ID] * len(batch),
                    "pids": [r["pid"] for r in batch],
                    "tss":  [r["ts"]  for r in batch],
                    "qtys": [r["qty"] for r in batch],
                },
            )

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\nSeed complete — 2-year spa data for business_id=1")
    print(f"  Date range   : {START_DATE} → {END_DATE}")
    print(f"  Open days    : {len(day_rows):>5}  (Mon–Fri + Sun, no Sat)")
    print(f"  Day records  : {len(day_rows):>5}")
    print(f"  Sale records : {len(srec_rows):>5}  (product_id={PRODUCT_ID})")
    print(f"  Sale events  : {len(event_rows):>5}")

    # Weekday breakdown
    from collections import defaultdict
    wd_customers: dict[int, list[int]] = defaultdict(list)
    cur = START_DATE
    ri = 0
    for row in day_rows:
        d = date.fromisoformat(row["date"])
        wd_customers[d.weekday()].append(row["customers"])

    wd_names = {0:"Mon", 1:"Tue", 2:"Wed", 3:"Thu", 4:"Fri", 6:"Sun"}
    print("\n  Avg customers by weekday (both years combined):")
    for wd in [0,1,2,3,4,6]:
        vals = wd_customers[wd]
        print(f"    {wd_names[wd]}: avg {sum(vals)/len(vals):.1f}  (n={len(vals)})")


if __name__ == "__main__":
    run()

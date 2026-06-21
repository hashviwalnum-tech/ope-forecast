"""
Two-year realistic spa data seed (SQLAlchemy — requires DATABASE_URL in backend/.env).

5 products with service times 10/30/60/90/120 min for staffing stress-testing.
Multi-service visits: 55% single, 30% double, 15% triple.
Open days: Mon–Fri + Sunday | Hours: 09:00–19:00 Israel local time (UTC stored).

Run: python seed_2yr.py  (from backend/)
For Supabase cloud DB use gen_seed_chunks.py instead (no DB password needed).
"""
from __future__ import annotations

import random
from datetime import date, datetime, timedelta
from collections import defaultdict

from sqlalchemy import text
from app.db import engine

random.seed(42)

BUSINESS_ID = 1
START_DATE  = date(2024, 6, 17)
END_DATE    = date(2026, 6, 17)
OPEN_DAYS   = {0, 1, 2, 3, 4, 6}

PRODUCTS = [
    ("Quick Touch-Up",      45,  1,  10),
    ("Manicure",            85,  1,  30),
    ("Facial",             160,  1,  60),
    ("Relaxation Massage", 230,  1,  90),
    ("Signature Treatment",370,  1, 120),
]
SVC_MINS = [p[3] for p in PRODUCTS]

BASE = {0: 18, 1: 22, 2: 25, 3: 28, 4: 38, 6: 30}

SEASONAL = {
     1: 0.72,  2: 0.75,  3: 0.85,  4: 0.95,  5: 1.00,
     6: 1.05,  7: 1.22,  8: 1.18,  9: 1.02, 10: 0.95,
    11: 0.88, 12: 1.18,
}

NOISE = 0.15
YOY   = 0.10

HOURS  = list(range(9, 19))
HOUR_W = [6, 9, 14, 10, 7, 8, 13, 15, 11, 7]

HOUR_PROD_W = {
     9: [25, 40, 20, 10,  5],
    10: [22, 38, 22, 12,  6],
    11: [18, 35, 28, 14,  5],
    12: [15, 32, 30, 17,  6],
    13: [14, 28, 32, 18,  8],
    14: [12, 24, 32, 22, 10],
    15: [10, 20, 32, 26, 12],
    16: [10, 20, 30, 27, 13],
    17: [18, 28, 25, 20,  9],
    18: [28, 35, 20, 12,  5],
}

VISIT_CDF = [0.55, 0.85, 1.00]


def is_dst(d: date) -> bool:
    def last_sun(yr: int, mo: int) -> date:
        s = date(yr + 1, 1, 1) if mo == 12 else date(yr, mo + 1, 1)
        last = s - timedelta(days=1)
        return last - timedelta(days=(last.weekday() + 1) % 7)
    return last_sun(d.year, 3) <= d < last_sun(d.year, 10)


def _utc_offset(d: date) -> int:
    return 3 if is_dst(d) else 2


def _local_to_utc(d: date, hour: int, minute: int) -> datetime:
    return datetime(d.year, d.month, d.day, hour, minute) - timedelta(hours=_utc_offset(d))


def _pick_hour() -> int:
    r, c = random.random() * 100, 0.0
    for h, w in zip(HOURS, HOUR_W):
        c += w
        if r < c:
            return h
    return HOURS[-1]


def _pick_visit_size() -> int:
    r = random.random()
    for i, cdf in enumerate(VISIT_CDF):
        if r < cdf:
            return i + 1
    return 3


def _pick_products(n: int, hour: int) -> list[int]:
    weights = list(HOUR_PROD_W[hour])
    chosen: list[int] = []
    for _ in range(n):
        total = sum(weights)
        if total == 0:
            break
        r, c = random.random() * total, 0.0
        for i, w in enumerate(weights):
            c += w
            if r < c:
                chosen.append(i)
                weights[i] = 0
                break
    return chosen


def _year_mult(d: date) -> float:
    return 1.0 + YOY if d >= date(2025, 6, 17) else 1.0


def generate():
    dr_rows:  list[dict] = []     # {date, customers}
    sr_rows:  list[dict] = []     # {prod_idx, units_sold}  — parallel to dr_rows per product
    ev_rows:  list[dict] = []     # {prod_idx, ts, qty}

    # sr_rows is actually a list of lists (one list of product counts per day)
    sr_day_rows: list[dict[int, int]] = []

    cur = START_DATE
    while cur <= END_DATE:
        if cur.weekday() in OPEN_DAYS:
            customers = max(5, round(
                BASE[cur.weekday()] * SEASONAL[cur.month] * _year_mult(cur)
                * (1 + random.uniform(-NOISE, NOISE))
            ))
            dr_rows.append({"date": cur.isoformat(), "customers": customers})

            prod_counts: dict[int, int] = defaultdict(int)
            for _ in range(customers):
                h, m = _pick_hour(), random.randint(0, 59)
                prods = _pick_products(_pick_visit_size(), h)
                utc_ts = _local_to_utc(cur, h, m)
                for p in prods:
                    ev_rows.append({
                        "prod_idx": p,
                        "ts": utc_ts.strftime("%Y-%m-%d %H:%M:%S"),
                        "qty": 1.0,
                    })
                    prod_counts[p] += 1

            sr_day_rows.append(dict(prod_counts))

        cur += timedelta(days=1)

    return dr_rows, sr_day_rows, ev_rows


def run() -> None:
    dr_rows, sr_day_rows, ev_rows = generate()

    with engine.begin() as conn:
        # ── Wipe existing data (FK-safe order) ───────────────────────────────
        conn.execute(text("DELETE FROM sale_events   WHERE business_id = :bid"), {"bid": BUSINESS_ID})
        conn.execute(text("DELETE FROM forecast_runs WHERE business_id = :bid"), {"bid": BUSINESS_ID})
        try:
            conn.execute(text("DELETE FROM tuner_logs WHERE business_id = :bid"), {"bid": BUSINESS_ID})
        except Exception:
            pass
        conn.execute(text("""
            DELETE FROM sale_records
            WHERE day_record_id IN (SELECT id FROM day_records WHERE business_id = :bid)
        """), {"bid": BUSINESS_ID})
        conn.execute(text("DELETE FROM day_records WHERE business_id = :bid"), {"bid": BUSINESS_ID})
        try:
            conn.execute(text("DELETE FROM stock_batches WHERE business_id = :bid"), {"bid": BUSINESS_ID})
        except Exception:
            pass
        try:
            conn.execute(text("DELETE FROM order_records WHERE business_id = :bid"), {"bid": BUSINESS_ID})
        except Exception:
            pass
        conn.execute(text("DELETE FROM products WHERE business_id = :bid"), {"bid": BUSINESS_ID})

        # ── Insert products, capture IDs ──────────────────────────────────────
        prod_ids: list[int] = []
        for name, price, lead_time, svc_min in PRODUCTS:
            result = conn.execute(text("""
                INSERT INTO products (business_id, name, unit, unit_mode, price, lead_time_days, service_time_minutes)
                VALUES (:bid, :name, 'session', 'whole', :price, :lt, :sm)
                RETURNING id
            """), {"bid": BUSINESS_ID, "name": name, "price": float(price),
                   "lt": lead_time, "sm": float(svc_min)})
            prod_ids.append(result.scalar_one())

        # ── Insert day_records, capture IDs ──────────────────────────────────
        dr_ids: list[int] = []
        for row in dr_rows:
            result = conn.execute(text("""
                INSERT INTO day_records (business_id, date, customers)
                VALUES (:bid, :date, :customers)
                RETURNING id
            """), {"bid": BUSINESS_ID, "date": row["date"], "customers": row["customers"]})
            dr_ids.append(result.scalar_one())

        # ── Insert sale_records ───────────────────────────────────────────────
        for dr_id, prod_counts in zip(dr_ids, sr_day_rows):
            for prod_idx, units in sorted(prod_counts.items()):
                conn.execute(text("""
                    INSERT INTO sale_records (day_record_id, product_id, units_sold)
                    VALUES (:drid, :pid, :units)
                """), {"drid": dr_id, "pid": prod_ids[prod_idx], "units": float(units)})

        # ── Insert sale_events in batches of 500 ─────────────────────────────
        batch_size = 500
        for i in range(0, len(ev_rows), batch_size):
            batch = ev_rows[i:i + batch_size]
            conn.execute(
                text("""
                    INSERT INTO sale_events (business_id, product_id, timestamp, quantity)
                    SELECT b.bid, b.pid, b.ts::timestamptz, b.qty
                    FROM unnest(:bids::int[], :pids::int[], :tss::text[], :qtys::float[])
                         AS b(bid, pid, ts, qty)
                """),
                {
                    "bids": [BUSINESS_ID] * len(batch),
                    "pids": [prod_ids[r["prod_idx"]] for r in batch],
                    "tss":  [r["ts"] for r in batch],
                    "qtys": [r["qty"] for r in batch],
                },
            )

    # ── Summary ───────────────────────────────────────────────────────────────
    total_ev = len(ev_rows)
    total_cu = sum(r["customers"] for r in dr_rows)
    ev_by_prod: dict[int, int] = defaultdict(int)
    for r in ev_rows:
        ev_by_prod[r["prod_idx"]] += 1

    print("\nSeed complete — 2-year spa data for business_id=1")
    print(f"  Date range   : {START_DATE} → {END_DATE}")
    print(f"  Open days    : {len(dr_rows)}  (Mon–Fri + Sun, no Sat)")
    print(f"  Day records  : {len(dr_rows)}")
    print(f"  Products     : {len(PRODUCTS)} (IDs: {prod_ids})")
    print(f"  Sale records : (multiple per day — one per product sold)")
    print(f"  Sale events  : {total_ev:,}")
    print(f"  Avg events/customer: {total_ev/total_cu:.2f}")

    wd_avg: dict[int, list] = defaultdict(list)
    for row in dr_rows:
        wd_avg[date.fromisoformat(row["date"]).weekday()].append(row["customers"])

    wd = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 6: "Sun"}
    print("\n  Products and their events:")
    for i, (n, pr, lt, sm) in enumerate(PRODUCTS):
        print(f"    [{i}] {n}: {sm} min | {ev_by_prod[i]:,} events | id={prod_ids[i]}")
    print("\n  Avg customers by weekday (both years combined):")
    for w in [0, 1, 2, 3, 4, 6]:
        vals = wd_avg[w]
        print(f"    {wd[w]}: avg {sum(vals)/len(vals):.1f}  (n={len(vals)})")


if __name__ == "__main__":
    run()

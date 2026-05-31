"""
Seed the database with 10 weeks of realistic fake daily data.

Run from the backend/ directory:
    python seed.py

Safe to re-run: wipes and recreates all rows each time.
"""
from __future__ import annotations

import random
from datetime import date, timedelta

from app.db import engine
from app.models import Base, Business, DayRecord, ForecastRun, Period, Product, SaleRecord
from sqlalchemy.orm import Session

# Fixed seed → reproducible data every run
random.seed(42)

# Base customer counts by weekday (0=Mon … 6=Sun).
# Clear pattern: midweek flat, Fri uptick, weekend bump.
BASE_CUSTOMERS: dict[int, int] = {
    0: 80,   # Monday
    1: 85,   # Tuesday
    2: 92,   # Wednesday
    3: 88,   # Thursday
    4: 108,  # Friday — end-of-week bump
    5: 158,  # Saturday — peak
    6: 132,  # Sunday
}
NOISE = 0.12   # ±12% random noise around each base


def _noisy(base: int) -> int:
    return max(1, round(base * (1 + random.uniform(-NOISE, NOISE))))


def main() -> None:
    # Create all tables (idempotent)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        # Wipe in FK-safe order so re-runs start clean
        session.query(ForecastRun).delete()
        session.query(SaleRecord).delete()
        session.query(Period).delete()
        session.query(DayRecord).delete()
        session.query(Product).delete()
        session.query(Business).delete()
        session.commit()

        # ── Business ──────────────────────────────────────────────────────
        biz = Business(
            name="Corner Café",
            settings={
                "opening_days": [0, 1, 2, 3, 4, 5, 6],
                "default_lead_time_days": 3,
                "target_service_level": 0.95,
            },
        )
        session.add(biz)
        session.flush()  # populate biz.id

        # ── Product ───────────────────────────────────────────────────────
        product = Product(
            business_id=biz.id,
            name="House Coffee Blend",
            unit="kg",
            current_stock=5.0,
            lead_time_days=3,
            holding_cost=2.50,
            order_cost=15.00,
        )
        session.add(product)
        session.flush()

        # ── 10 weeks of DayRecords + SaleRecords ─────────────────────────
        start = date.today() - timedelta(weeks=10)
        for offset in range(70):  # 10 weeks × 7 days
            d = start + timedelta(days=offset)
            customers = _noisy(BASE_CUSTOMERS[d.weekday()])

            dr = DayRecord(
                business_id=biz.id,
                date=d,
                customers=customers,
            )
            session.add(dr)
            session.flush()

            # Each customer buys roughly 0.12 kg of coffee; ±10% extra noise
            units = max(0.0, round(customers * 0.12 * (1 + random.uniform(-0.10, 0.10)), 2))
            session.add(SaleRecord(
                day_record_id=dr.id,
                product_id=product.id,
                units_sold=units,
            ))

        session.commit()

        # ── Row counts ────────────────────────────────────────────────────
        counts = {
            "businesses":   session.query(Business).count(),
            "products":     session.query(Product).count(),
            "day_records":  session.query(DayRecord).count(),
            "sale_records": session.query(SaleRecord).count(),
        }

    print("Seed complete:")
    for table, n in counts.items():
        print(f"  {table:<16} {n:>4} rows")


if __name__ == "__main__":
    main()

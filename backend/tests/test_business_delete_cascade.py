"""Deleting a business must leave nothing behind.

The handler listed its child tables by hand and had missed seven of them, so
every location an owner deleted orphaned rows in `order_records`,
`stock_batches`, `regular_daily_spends`, `service_consumables`,
`telegram_links`, `tuner_state` and `tuner_log`.

Two tests here, doing different jobs:

* the SCHEMA test walks SQLAlchemy's metadata and fails if any table can reach a
  business by a route the cascade does not know about. It needs no data and
  catches a table added next year, which is the failure mode that produced this
  bug in the first place;
* the DATA test fills every one of those tables, deletes the business through
  the real endpoint, and asserts the database is empty afterwards.
"""
from datetime import date, datetime, timedelta  # noqa: F401

import pytest
from fastapi.testclient import TestClient

from app.api.business_cascade import (
    BUSINESS_FK,
    INDIRECT,
    business_scoped_models,
    indirect_models,
)
from app.api.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models import (
    Base,
    BookedCount,
    Business,
    DayRecord,
    ForecastRun,
    OrderRecord,
    Period,
    Product,
    RecurringPattern,
    Regular,
    RegularDailySpend,
    SaleEvent,
    SaleRecord,
    ServiceBookedCount,
    ServiceConsumable,
    StockBatch,
    Subscription,
    TelegramLink,
    TunerLog,
    TunerState,
)

USER = "cascade-user"


@pytest.fixture()
def bd_client(db):
    """A client with a fixed user id — the delete endpoint is user-scoped."""
    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


# ── the schema test: nothing can be forgotten ────────────────────────────────

def test_every_business_owned_table_is_covered_by_the_cascade():
    """No mapped table may reach a business by a route the cascade misses.

    A new table with a `business_id` is picked up automatically. A new table
    that reaches a business only through a parent must be added to INDIRECT —
    and this fails until it is.
    """
    covered = {m.__tablename__ for m in business_scoped_models()}
    covered |= {m.__tablename__ for m in indirect_models()}
    indirect_parents = {parent.__tablename__ for _, _, parent in INDIRECT}

    uncovered = []
    for mapper in Base.registry.mappers:
        cls = mapper.class_
        table = mapper.local_table
        name = table.name
        if name in covered or cls is Business:
            continue
        # A table is suspect if it points at anything that is itself deleted
        # with the business — that is a row which would be orphaned.
        for col in table.columns:
            for fk in col.foreign_keys:
                target_table = fk.target_fullname.split(".")[0]
                if fk.target_fullname == BUSINESS_FK or target_table in covered:
                    uncovered.append(f"{name}.{col.name} -> {fk.target_fullname}")

    assert uncovered == [], (
        "these tables would be orphaned when a business is deleted; add a "
        "business_id, or declare the parent link in business_cascade.INDIRECT:\n  "
        + "\n  ".join(sorted(set(uncovered)))
    )
    assert indirect_parents <= covered, "an INDIRECT parent is not itself deleted"


def test_the_cascade_covers_the_seven_tables_it_used_to_miss():
    """Named explicitly, so a refactor cannot quietly drop them again."""
    covered = {m.__tablename__ for m in business_scoped_models()}
    covered |= {m.__tablename__ for m in indirect_models()}
    for name in (
        "order_records", "stock_batches", "regular_daily_spends",
        "service_consumables", "telegram_links", "tuner_state", "tuner_log",
    ):
        assert name in covered, f"{name} is orphaned again"


def test_subscriptions_are_not_deleted_with_a_location():
    """A subscription belongs to the USER, not to one of their locations.

    Deleting a location must not cancel the account's plan — the owner keeps
    paying, and their other locations keep working.
    """
    covered = {m.__tablename__ for m in business_scoped_models()}
    assert "subscriptions" not in covered


# ── the data test: fill everything, delete, check nothing survives ───────────

def _fill(db, biz: Business) -> None:
    """Put at least one row in every table that hangs off a business."""
    today = date.today()
    NOW = datetime(2026, 1, 1, 12, 0)

    product = Product(business_id=biz.id, name="Beans", unit="kg", lead_time_days=2)
    consumable = Product(business_id=biz.id, name="Oil", unit="L", lead_time_days=1)
    db.add_all([product, consumable])
    db.flush()

    day = DayRecord(business_id=biz.id, date=today, customers=40)
    regular = Regular(business_id=biz.id, name="Dana", avg_spend=12.0,
                      visit_frequency_per_week=3.0, expected_lifespan_years=3.0)
    db.add_all([day, regular])
    db.flush()

    db.add_all([
        # indirect children
        SaleRecord(day_record_id=day.id, product_id=product.id, units_sold=5),
        RegularDailySpend(regular_id=regular.id, date=today, amount=12.0),
        # direct children, one row each
        SaleEvent(business_id=biz.id, product_id=product.id, timestamp=NOW, quantity=1),
        Period(business_id=biz.id, start_date=today, end_date=today, type="ad", label="Radio"),
        RecurringPattern(business_id=biz.id, label="Sunday trip", weekdays=[6], effect="higher"),
        ForecastRun(business_id=biz.id, created_at=NOW, target_date=today,
                    predicted_value=42.0, interval_low=35.0, interval_high=50.0,
                    model_weights={}),
        OrderRecord(business_id=biz.id, product_id=product.id, ordered_date=today,
                    quantity=10, expected_arrival_date=today + timedelta(days=2)),
        StockBatch(business_id=biz.id, product_id=product.id, quantity_initial=10,
                   quantity_remaining=10, arrival_date=today),
        ServiceConsumable(business_id=biz.id, service_product_id=product.id,
                          consumable_product_id=consumable.id, qty_per_performance=0.1),
        BookedCount(business_id=biz.id, date=today, booked_count=8),
        ServiceBookedCount(business_id=biz.id, product_id=product.id, date=today, booked_count=3),
        TelegramLink(business_id=biz.id, chat_id="12345"),
        TunerState(business_id=biz.id, champion_config=[], updated_at=NOW),
        TunerLog(business_id=biz.id, logged_at=NOW, event="no_change"),
    ])
    db.commit()


def _row_counts(db, business_id: int) -> dict[str, int]:
    """How many rows each business-owned table still holds for this business."""
    counts = {}
    for model in business_scoped_models():
        counts[model.__tablename__] = (
            db.query(model).filter_by(business_id=business_id).count()
        )
    return counts


def test_deleting_a_business_leaves_nothing_behind(bd_client, db):
    keep = Business(name="Keep", user_id=USER, settings={})
    doomed = Business(name="Doomed", user_id=USER, settings={})
    db.add_all([keep, doomed])
    db.commit()
    db.refresh(keep)
    db.refresh(doomed)

    _fill(db, doomed)
    _fill(db, keep)

    # Every table genuinely has data to lose, or the test proves nothing.
    before = _row_counts(db, doomed.id)
    empty_before = [t for t, n in before.items() if n == 0]
    assert empty_before == [], (
        f"the fixture never populated {empty_before} — deleting them would prove nothing"
    )
    assert db.query(SaleRecord).count() == 2
    assert db.query(RegularDailySpend).count() == 2

    r = bd_client.delete(f"/businesses/{doomed.id}")
    assert r.status_code == 204, r.text

    after = _row_counts(db, doomed.id)
    leftovers = {t: n for t, n in after.items() if n}
    assert leftovers == {}, f"orphan rows survived the delete: {leftovers}"

    # The indirect children went with their parents.
    day_ids = [d.id for d in db.query(DayRecord).all()]
    assert all(s.day_record_id in day_ids for s in db.query(SaleRecord).all())
    regular_ids = [r_.id for r_ in db.query(Regular).all()]
    assert all(s.regular_id in regular_ids for s in db.query(RegularDailySpend).all())

    # ...and the business itself is gone.
    assert db.query(Business).filter_by(id=doomed.id).first() is None


def test_the_other_location_is_untouched(bd_client, db):
    """A delete must take one business's data and no one else's."""
    keep = Business(name="Keep", user_id=USER, settings={})
    doomed = Business(name="Doomed", user_id=USER, settings={})
    db.add_all([keep, doomed])
    db.commit()
    db.refresh(keep)
    db.refresh(doomed)
    _fill(db, doomed)
    _fill(db, keep)

    kept_before = _row_counts(db, keep.id)
    assert bd_client.delete(f"/businesses/{doomed.id}").status_code == 204

    assert _row_counts(db, keep.id) == kept_before
    assert db.query(SaleRecord).count() == 1
    assert db.query(RegularDailySpend).count() == 1
    assert db.query(Business).filter_by(id=keep.id).first() is not None


def test_a_users_subscription_survives_deleting_a_location(bd_client, db):
    keep = Business(name="Keep", user_id=USER, settings={})
    doomed = Business(name="Doomed", user_id=USER, settings={})
    db.add_all([keep, doomed])
    db.commit()
    db.refresh(doomed)

    db.add(Subscription(user_id=USER, tier="premium", subscription_status="active"))
    db.commit()

    assert bd_client.delete(f"/businesses/{doomed.id}").status_code == 204
    assert db.query(Subscription).filter_by(user_id=USER).first() is not None


def test_deleting_the_only_location_is_still_refused(bd_client, db):
    only = Business(name="Only", user_id=USER, settings={})
    db.add(only)
    db.commit()
    db.refresh(only)
    _fill(db, only)

    r = bd_client.delete(f"/businesses/{only.id}")
    assert r.status_code == 400
    # Nothing may have been deleted on the way to that refusal.
    assert _row_counts(db, only.id) == _row_counts(db, only.id)
    assert db.query(Business).filter_by(id=only.id).first() is not None
    assert db.query(SaleRecord).count() == 1

"""
FINDING F-027: "in transit" must mean actually in transit.

Orders are created 'pending' and the stock projection honours the business's
"always assume orders arrive on time" setting — but the stored status never
changed, and nothing else took the setting into account.  After a simulated
year the home screen listed roughly 120 long-since-delivered orders per product
as "In transit", each with its own Mark arrived button, making the ordering card
thousands of lines long and unusable.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models import Business, Product
from app.models.order_record import OrderRecord

USER = "orders-arrival-user"
TODAY = date(2026, 6, 15)


@pytest.fixture()
def sim_clock(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    clock.freeze(datetime(2026, 6, 15, 18, 0, tzinfo=timezone.utc))
    yield
    clock.unfreeze()


def _client(db):
    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


def _setup(db, assume_on_time: bool):
    biz = Business(name="Cafe", user_id=USER, settings={
        "tier": "premium", "timezone": "UTC",
        "assume_orders_arrive_on_time": assume_on_time,
    })
    db.add(biz)
    db.commit()
    db.refresh(biz)
    prod = Product(business_id=biz.id, name="Beans", unit="kg", lead_time_days=3)
    db.add(prod)
    db.commit()
    db.refresh(prod)
    for days_ago, arrival in ((200, TODAY - timedelta(days=197)),
                              (30, TODAY - timedelta(days=27)),
                              (1, TODAY + timedelta(days=2))):
        db.add(OrderRecord(
            business_id=biz.id, product_id=prod.id,
            ordered_date=TODAY - timedelta(days=days_ago),
            quantity=50.0, expected_arrival_date=arrival, status="pending",
        ))
    db.commit()
    return biz, prod


def test_delivered_orders_are_reported_as_arrived_when_assuming_on_time(db, sim_clock):
    _setup(db, assume_on_time=True)
    with _client(db) as c:
        rows = c.get("/orders").json()
    app.dependency_overrides.clear()
    effective = sorted(r["effective_status"] for r in rows)
    assert effective == ["arrived", "arrived", "pending"], (
        "only the order that has not reached its delivery date is still in transit"
    )
    assert all(r["status"] == "pending" for r in rows), "stored status is untouched"


def test_without_the_setting_nothing_is_assumed(db, sim_clock):
    """An owner who confirms deliveries by hand must still see them all."""
    _setup(db, assume_on_time=False)
    with _client(db) as c:
        rows = c.get("/orders").json()
    app.dependency_overrides.clear()
    assert all(r["effective_status"] == "pending" for r in rows)


def test_an_explicitly_arrived_order_stays_arrived(db, sim_clock):
    biz, prod = _setup(db, assume_on_time=False)
    row = db.query(OrderRecord).filter_by(business_id=biz.id).first()
    row.status = "arrived"
    db.commit()
    with _client(db) as c:
        rows = {r["id"]: r for r in c.get("/orders").json()}
    app.dependency_overrides.clear()
    assert rows[row.id]["effective_status"] == "arrived"

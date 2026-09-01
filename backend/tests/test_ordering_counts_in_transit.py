"""Reorder advice counts stock that is already on its way.

From the UX review: the ordering card showed "393 cups in stock", listed 1,642
and 1,319 cups in transit, and still advised ordering 2,107 more. The advice was
comparing the reorder point against what was on the SHELF, so it repeated itself
every day until a delivery landed — and an owner following it would have ordered
several times over.

The decision is made against the inventory *position* now: on hand plus on
order. The reorder point is sized to cover exactly one lead time, which is the
window a delivery already in transit lands inside, so counting it is what makes
the trigger mean what it says.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models import Business, DayRecord, Product, SaleRecord
from app.models.order_record import OrderRecord

USER = "in-transit-ordering-user"
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


def _shop(db, *, daily_units: float = 40.0, days: int = 40, stock: float = 60.0):
    """A shop selling a steady amount, with its stock counted this morning."""
    biz = Business(name="Steady Cafe", user_id=USER, settings={
        "tier": "premium", "timezone": "UTC",
        "opening_days": [0, 1, 2, 3, 4, 5, 6],
        "assume_orders_arrive_on_time": False,
    })
    db.add(biz)
    db.commit()
    db.refresh(biz)

    prod = Product(
        business_id=biz.id, name="Beans", unit="kg", lead_time_days=3,
        current_stock=stock, stock_as_of_date=TODAY,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)

    for i in range(days, 0, -1):
        day = DayRecord(business_id=biz.id, date=TODAY - timedelta(days=i), customers=100)
        db.add(day)
        db.commit()
        db.refresh(day)
        db.add(SaleRecord(day_record_id=day.id, product_id=prod.id, units_sold=daily_units))
    db.commit()
    return biz, prod


def _row(client, product_id: int) -> dict:
    body = client.get("/ordering").json()
    assert body["status"] == "ok", body
    return next(r for r in body["products"] if r["product_id"] == product_id)


def test_with_nothing_on_the_way_a_low_shop_is_told_to_order(db, sim_clock):
    biz, prod = _shop(db)
    with _client(db) as c:
        row = _row(c, prod.id)
    app.dependency_overrides.clear()
    assert row["order_now"] is True
    assert row["suggested_order_qty"] > 0
    assert row["on_order_qty"] == 0


def test_a_delivery_in_transit_stops_the_repeat_recommendation(db, sim_clock):
    """The bug itself: the same order recommended again while it is in transit."""
    biz, prod = _shop(db)
    with _client(db) as c:
        before = _row(c, prod.id)
        assert before["order_now"] is True

        # Place exactly what Ope just advised.
        placed = c.post("/orders", json={
            "product_id": prod.id,
            "ordered_date": TODAY.isoformat(),
            "quantity": before["suggested_order_qty"],
        })
        assert placed.status_code in (200, 201), placed.text

        after = _row(c, prod.id)
    app.dependency_overrides.clear()

    assert after["on_order_qty"] == pytest.approx(before["suggested_order_qty"])
    assert after["order_now"] is False, "already ordered — not advised again"
    assert after["suggested_order_qty"] == 0


def test_stock_on_the_shelf_is_still_reported_as_it_was(db, sim_clock):
    """Counting the delivery must not quietly inflate the stock figure shown."""
    biz, prod = _shop(db)
    with _client(db) as c:
        before = _row(c, prod.id)
        c.post("/orders", json={
            "product_id": prod.id, "ordered_date": TODAY.isoformat(), "quantity": 500,
        })
        after = _row(c, prod.id)
    app.dependency_overrides.clear()
    assert after["projected_stock"] == before["projected_stock"]
    assert after["current_stock"] == before["current_stock"]


def test_a_delivery_too_small_to_cover_the_gap_still_advises_ordering(db, sim_clock):
    """Counting what is coming is not the same as assuming it is enough."""
    biz, prod = _shop(db)
    with _client(db) as c:
        c.post("/orders", json={
            "product_id": prod.id, "ordered_date": TODAY.isoformat(), "quantity": 1,
        })
        row = _row(c, prod.id)
    app.dependency_overrides.clear()
    assert row["on_order_qty"] == pytest.approx(1)
    assert row["order_now"] is True, "one unit does not cover a three-day lead time"


def test_a_cancelled_order_stops_counting(db, sim_clock):
    biz, prod = _shop(db)
    with _client(db) as c:
        created = c.post("/orders", json={
            "product_id": prod.id, "ordered_date": TODAY.isoformat(), "quantity": 500,
        }).json()
        assert _row(c, prod.id)["order_now"] is False
        c.delete(f"/orders/{created['id']}")
        row = _row(c, prod.id)
    app.dependency_overrides.clear()
    assert row["on_order_qty"] == 0
    assert row["order_now"] is True, "the order was cancelled — nothing is coming"


def test_an_order_already_counted_as_arrived_is_not_counted_twice(db, sim_clock):
    """With "assume orders arrive on time" on, a delivery whose date has passed
    is already in the stock projection, so it must not also count as on its way."""
    biz, prod = _shop(db)
    biz.settings = {**biz.settings, "assume_orders_arrive_on_time": True}
    db.add(OrderRecord(
        business_id=biz.id, product_id=prod.id,
        ordered_date=TODAY - timedelta(days=10),
        quantity=500.0,
        expected_arrival_date=TODAY - timedelta(days=7),   # long since due
        status="pending",
    ))
    db.commit()
    with _client(db) as c:
        row = _row(c, prod.id)
    app.dependency_overrides.clear()
    assert row["on_order_qty"] == 0, "counted as arrived stock, not as in transit"


def test_the_product_forecast_agrees_with_the_ordering_screen(db, sim_clock):
    """Two screens showing the same product must not disagree about ordering."""
    biz, prod = _shop(db)
    with _client(db) as c:
        c.post("/orders", json={
            "product_id": prod.id, "ordered_date": TODAY.isoformat(), "quantity": 500,
        })
        ordering = _row(c, prod.id)
        pf = c.get("/product-forecast").json()
    app.dependency_overrides.clear()
    item = next(p for p in pf["products"] if p["product_id"] == prod.id)
    assert item["order_now"] == ordering["order_now"] is False
    assert item["on_order_qty"] == pytest.approx(ordering["on_order_qty"])

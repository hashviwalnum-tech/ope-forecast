"""GET /forecast in the first fortnight says what the owner gets, and when.

Each milestone is counted the way its own feature counts, so a tick in the
apps means the thing really appears: busy hours need days with taps, product
demand needs days of a product's sales, the forecasts need logged days.
"""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api.deps import get_business, get_tier
from app.api.deps import get_business_staff_ok
from app.db import get_db
from app.engine.limits import Tier
from app.main import app
from app.models import DayRecord, Product, SaleEvent, SaleRecord


@pytest.fixture()
def client(db, biz):
    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_business] = lambda: biz
    app.dependency_overrides[get_business_staff_ok] = lambda: biz
    app.dependency_overrides[get_tier] = lambda: Tier('free')
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _m(body: dict) -> dict[str, tuple[int, int]]:
    return {m["key"]: (m["have"], m["needed"]) for m in body["milestones"]}


def test_a_brand_new_owner_sees_every_milestone_at_zero(client):
    body = client.get("/forecast").json()
    assert body["status"] == "not_enough_data"
    assert body["days_logged"] == 0 and body["days_needed"] == 14
    assert _m(body) == {
        "rough_range": (0, 2), "product_demand": (0, 7),
        "busy_hours": (0, 7), "full_forecast": (0, 14),
    }


def test_each_milestone_counts_its_own_kind_of_data(client, db, biz):
    """Three days typed in; one of them with a product's sales; taps on two
    days (one of those a day with no typed record at all, still today)."""
    today = clock.today_local(biz.settings)
    coffee = Product(business_id=biz.id, name="Coffee", unit="cups")
    db.add(coffee)
    db.flush()
    recs = []
    for back in (3, 4, 5):
        r = DayRecord(business_id=biz.id, date=today - timedelta(days=back), customers=40)
        db.add(r)
        recs.append(r)
    db.flush()
    db.add(SaleRecord(day_record_id=recs[0].id, product_id=coffee.id, units_sold=12))
    for back in (3, 0):
        d = today - timedelta(days=back)
        db.add(SaleEvent(business_id=biz.id, product_id=None, quantity=1,
                         timestamp=datetime(d.year, d.month, d.day, 10, 0)))
    db.commit()

    body = client.get("/forecast").json()
    m = _m(body)
    assert m["rough_range"] == (3, 2)
    assert m["full_forecast"] == (3, 14)
    assert m["product_demand"] == (1, 7)
    assert m["busy_hours"] == (2, 7)


def test_milestones_are_gone_once_the_forecast_is_ready(client, db, biz):
    today = clock.today_local(biz.settings)
    for back in range(1, 22):
        db.add(DayRecord(business_id=biz.id, date=today - timedelta(days=back), customers=40 + back % 7))
    db.commit()
    body = client.get("/forecast").json()
    assert body["status"] == "ok"
    assert body["milestones"] == []

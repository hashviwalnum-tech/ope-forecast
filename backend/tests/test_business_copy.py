"""
Tests for "copy settings & products to a new location" (premium, spec §10).

FINDING F-016: the copy wrote a fixed field list that omitted `product_type`,
`is_favorite` and the service→consumable links.  A spa's "60-minute Massage"
copied to a second branch arrived as a **stocked good with no lead time** — an
invalid product the new branch would then be told to reorder — and any supplies
it drew down were silently forgotten.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models import Business, Product
from app.models.service_consumable import ServiceConsumable
from app.models.subscription import Subscription

USER = "copy-test-user"


@pytest.fixture()
def copy_client(db):
    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def premium_spa(db):
    """A premium account with one location holding a service + its consumable."""
    # A genuinely paying subscriber — the tier now resolves from the subscription
    # on every request, so a bare settings flag would (correctly) be reset.
    db.add(Subscription(user_id=USER, tier="premium", subscription_status="active"))
    biz = Business(name="Serenity Spa — Main", user_id=USER, settings={
        "tier": "premium", "timezone": "Europe/London", "opening_hour": 9, "closing_hour": 18,
    })
    db.add(biz)
    db.commit()
    db.refresh(biz)

    oil = Product(business_id=biz.id, name="Massage Oil", unit="bottles",
                  product_type="stocked", unit_mode="decimal", lead_time_days=5,
                  shelf_life_days=400, storage_capacity=60, current_stock=30,
                  price=14.0, is_favorite=True)
    massage = Product(business_id=biz.id, name="60-minute Massage", unit="bookings",
                      product_type="service", unit_mode="whole",
                      service_time_minutes=60.0, price=95.0)
    db.add_all([oil, massage])
    db.commit()
    db.refresh(oil)
    db.refresh(massage)

    db.add(ServiceConsumable(business_id=biz.id, service_product_id=massage.id,
                             consumable_product_id=oil.id, qty_per_performance=0.1))
    db.commit()
    return biz, massage, oil


def test_copied_service_stays_a_service(copy_client, db, premium_spa):
    biz, massage, oil = premium_spa
    r = copy_client.post(f"/businesses/{biz.id}/copy", json={"name": "Serenity Spa — Riverside"})
    assert r.status_code == 201, r.text
    new_id = r.json()["id"]

    copied = {p.name: p for p in db.query(Product).filter_by(business_id=new_id).all()}
    assert set(copied) == {"Massage Oil", "60-minute Massage"}

    massage_copy = copied["60-minute Massage"]
    assert massage_copy.product_type == "service", (
        "a service copied to a new location must still be a service — otherwise "
        "the new branch is told to reorder massages"
    )
    assert massage_copy.service_time_minutes == 60.0


def test_copied_products_keep_their_settings(copy_client, db, premium_spa):
    biz, _massage, _oil = premium_spa
    new_id = copy_client.post(f"/businesses/{biz.id}/copy",
                              json={"name": "Branch 2"}).json()["id"]
    oil_copy = db.query(Product).filter_by(business_id=new_id, name="Massage Oil").one()
    assert oil_copy.product_type == "stocked"
    assert oil_copy.unit_mode == "decimal"
    assert oil_copy.is_favorite is True
    assert oil_copy.lead_time_days == 5
    assert oil_copy.shelf_life_days == 400
    assert oil_copy.storage_capacity == 60
    assert oil_copy.price == 14.0


def test_service_consumable_links_come_along(copy_client, db, premium_spa):
    biz, _massage, _oil = premium_spa
    new_id = copy_client.post(f"/businesses/{biz.id}/copy",
                              json={"name": "Branch 3"}).json()["id"]

    links = db.query(ServiceConsumable).filter_by(business_id=new_id).all()
    assert len(links) == 1, "the service's supplies are configuration and must be copied"
    link = links[0]
    assert link.qty_per_performance == 0.1

    # And they must point at the NEW location's products, not the source's.
    new_ids = {p.id for p in db.query(Product).filter_by(business_id=new_id).all()}
    assert link.service_product_id in new_ids
    assert link.consumable_product_id in new_ids


def test_stock_and_history_are_not_copied(copy_client, db, premium_spa):
    """Spec §10 is explicit: configuration copies, data does not."""
    biz, _m, _o = premium_spa
    new_id = copy_client.post(f"/businesses/{biz.id}/copy",
                              json={"name": "Branch 4"}).json()["id"]
    for p in db.query(Product).filter_by(business_id=new_id).all():
        assert p.current_stock is None


def test_free_account_cannot_copy(copy_client, db):
    biz = Business(name="Solo Cafe", user_id=USER, settings={"tier": "free"})
    db.add(biz)
    db.commit()
    db.refresh(biz)
    r = copy_client.post(f"/businesses/{biz.id}/copy", json={"name": "Second Cafe"})
    assert r.status_code == 403
    assert "premium" in r.json()["detail"].lower()

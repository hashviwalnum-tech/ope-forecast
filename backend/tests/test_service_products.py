"""
Tests for stocked vs service product type behaviour.

Three cases from the spec:
1. A service shows no reorder in /ordering.
2. A service with a linked consumable draws down that consumable's projected stock.
3. A service with no consumable shows nothing about supplies (silent fallback).
"""
import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient

from app.api.deps import get_business
from app.db import get_db
from app.main import app
from app.models import Business, Product, DayRecord, SaleRecord
from app.models.service_consumable import ServiceConsumable


# ── fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture()
def spa_biz(db):
    """Business with enough DayRecords for /ordering (>= 14 clean days)."""
    biz = Business(name="Spa Biz", settings={})
    db.add(biz)
    db.commit()
    db.refresh(biz)

    base = date(2026, 1, 1)
    for i in range(20):
        dr = DayRecord(business_id=biz.id, date=base + timedelta(days=i), customers=10)
        db.add(dr)
    db.commit()
    return biz


@pytest.fixture()
def spa_client(db, spa_biz):
    """TestClient with get_db and get_business overridden to the spa_biz — no JWT."""
    def _db():
        yield db

    def _biz():
        return spa_biz

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_business] = _biz
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def service_product(db, spa_biz):
    """Massage service product with 10 days × 2 units of logged sales."""
    prod = Product(
        business_id=spa_biz.id,
        name="Massage",
        unit="session",
        product_type="service",
        lead_time_days=None,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)

    day_records = (
        db.query(DayRecord)
        .filter_by(business_id=spa_biz.id)
        .order_by(DayRecord.date)
        .limit(10)
        .all()
    )
    for dr in day_records:
        db.add(SaleRecord(day_record_id=dr.id, product_id=prod.id, units_sold=2))
    db.commit()
    return prod


@pytest.fixture()
def oil_product(db, spa_biz):
    """Stocked massage-oil consumable with 100 units starting stock."""
    prod = Product(
        business_id=spa_biz.id,
        name="Massage Oil",
        unit="ml",
        product_type="stocked",
        lead_time_days=3,
        current_stock=100.0,
        stock_as_of_date=date(2025, 12, 31),  # before all sale records (base = 2026-01-01)
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)
    return prod


# ── Test 1: service does NOT appear in /ordering ───────────────────────────────

def test_service_excluded_from_ordering(spa_client, service_product):
    """A service product must not appear in the /ordering response."""
    resp = spa_client.get("/ordering")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    product_ids = [row["product_id"] for row in data.get("products", [])]
    assert service_product.id not in product_ids, (
        "Service product appeared in /ordering — it must be excluded"
    )


# ── Test 2: consumable stock is drawn down by service sales ────────────────────

def test_consumable_stock_drawn_down_by_service(db, spa_client, service_product, oil_product):
    """When a service is performed, its linked consumable's projected stock decreases."""
    link = ServiceConsumable(
        business_id=service_product.business_id,
        service_product_id=service_product.id,
        consumable_product_id=oil_product.id,
        qty_per_performance=20.0,  # 20 ml of oil per massage
    )
    db.add(link)
    db.commit()

    # 10 days × 2 massages × 20 ml = 400 ml consumed; starting stock = 100 ml
    # → projected stock must be well below 100 (or negative)
    resp = spa_client.get(f"/product-forecast?product_id={oil_product.id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    items = data.get("products", [])
    oil_item = next((p for p in items if p["product_id"] == oil_product.id), None)
    assert oil_item is not None, "Oil product not found in /product-forecast"

    proj = oil_item.get("projected_stock")
    if proj is not None:
        assert proj < 100.0, (
            f"Expected projected stock < 100 after service draw-down, got {proj}"
        )


# ── Test 3: service with no consumables — nothing about supplies ───────────────

def test_service_with_no_consumables_is_silent(spa_client, service_product):
    """A service with no linked consumables must not surface any stock/supply info."""
    resp = spa_client.get(f"/product-forecast?product_id={service_product.id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    items = data.get("products", [])
    svc = next((p for p in items if p["product_id"] == service_product.id), None)
    assert svc is not None, "Service product not found in /product-forecast"

    assert svc.get("current_stock") is None, "Service must not show current_stock"
    assert svc.get("projected_stock") is None, "Service must not show projected_stock"
    assert svc.get("order_now") is False, "Service must never trigger order_now"
    assert svc.get("approaching_reorder") is False, "Service must never trigger approaching_reorder"
    assert svc.get("suggested_order_qty", 0) == 0.0, "Service must have 0 suggested order qty"
    assert svc.get("product_type") == "service", "product_type must be 'service'"


# ── POST/PUT /products validation: stock-only fields don't block services ──────
# (Fixtures above build service_product via direct ORM construction, which
# bypasses the schema entirely — these tests go through the real endpoint,
# which is where the "lead_time_days must be >= 1 (got 0)" bug actually lived.)

@pytest.fixture()
def products_client(db, biz):
    def _db():
        yield db

    def _biz():
        return biz

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_business] = _biz
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


def test_create_service_product_succeeds(products_client):
    """A service ('performed, not stocked') must save without lead_time_days,
    current_stock, storage_capacity, or shelf_life_days — those are
    physical-good-only fields."""
    r = products_client.post("/products", json={
        "name": "Haircut",
        "unit": "session",
        "product_type": "service",
    })
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["product_type"] == "service"
    assert data["lead_time_days"] is None
    assert data["current_stock"] is None
    assert data["storage_capacity"] is None
    assert data["shelf_life_days"] is None


def test_create_stocked_product_with_zero_lead_time_still_fails(products_client):
    """A physical good must still require lead_time_days >= 1 — only services
    are exempt from this rule."""
    r = products_client.post("/products", json={
        "name": "Croissant",
        "unit": "piece",
        "product_type": "stocked",
        "lead_time_days": 0,
    })
    assert r.status_code == 422


def test_create_stocked_product_without_lead_time_fails(products_client):
    """Omitting lead_time_days entirely for a physical good must also fail —
    it's required for stocked products, just not for services."""
    r = products_client.post("/products", json={
        "name": "Croissant",
        "unit": "piece",
        "product_type": "stocked",
    })
    assert r.status_code == 422


def test_create_service_ignores_stray_stock_fields(products_client):
    """Even if a client mistakenly sends stock-only fields for a service, they
    must not be persisted."""
    r = products_client.post("/products", json={
        "name": "Consultation",
        "unit": "session",
        "product_type": "service",
        "current_stock": 5,
        "storage_capacity": 10,
        "shelf_life_days": 3,
    })
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["current_stock"] is None
    assert data["storage_capacity"] is None
    assert data["shelf_life_days"] is None


def test_update_stocked_to_service_clears_stock_fields(products_client):
    """Converting an existing physical good to a service via PUT must clear
    its stale stock-only fields, not leave them stranded."""
    r = products_client.post("/products", json={
        "name": "Bagel", "unit": "piece", "product_type": "stocked",
        "lead_time_days": 2, "current_stock": 40, "storage_capacity": 100, "shelf_life_days": 3,
    })
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    r2 = products_client.put(f"/products/{pid}", json={"product_type": "service"})
    assert r2.status_code == 200, r2.text
    data = r2.json()
    assert data["lead_time_days"] is None
    assert data["current_stock"] is None
    assert data["storage_capacity"] is None
    assert data["shelf_life_days"] is None


def test_create_order_for_service_rejected_cleanly(spa_client, service_product):
    """POST /orders for a service (lead_time_days=None) must return a clean
    400, not crash with an unhandled TypeError from `timedelta(days=None)`."""
    resp = spa_client.post("/orders", json={
        "product_id": service_product.id,
        "ordered_date": "2026-01-15",
        "quantity": 1,
    })
    assert resp.status_code == 400, resp.text


def test_update_unrelated_field_does_not_clear_stocked_product(products_client):
    """A PUT that doesn't touch product_type must not clobber an existing
    stocked product's lead_time_days/stock fields."""
    r = products_client.post("/products", json={
        "name": "Bagel", "unit": "piece", "product_type": "stocked",
        "lead_time_days": 2, "current_stock": 40,
    })
    pid = r.json()["id"]

    r2 = products_client.put(f"/products/{pid}", json={"price": 3.5})
    assert r2.status_code == 200, r2.text
    data = r2.json()
    assert data["lead_time_days"] == 2
    assert data["current_stock"] == 40

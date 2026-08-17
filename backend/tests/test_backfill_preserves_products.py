"""
FINDING F-006: submitting hourly customer counts wiped that day's product sales.

`backfill-hourly` deleted EVERY sale event in the day's window before writing,
so an owner who tapped products during service and later tidied up their hourly
customer counts from the register silently lost the whole product breakdown —
no warning, and nothing in the response to say anything had been removed.
Reachable from the Add Past Day form and from the CSV importer.

The rule now: **only replace the kind of data the submission actually provides.**
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models import Business, DayRecord, Product, SaleEvent, SaleRecord

USER = "backfill-user"
DAY = date(2026, 3, 10)


@pytest.fixture()
def sim_clock(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    clock.freeze(datetime(2026, 3, 11, 12, 0, tzinfo=timezone.utc))
    yield
    clock.unfreeze()


@pytest.fixture()
def shop(db):
    biz = Business(name="Tap Shop", user_id=USER, settings={
        "tier": "premium", "timezone": "UTC", "opening_hour": 9, "closing_hour": 17,
        "opening_days": [0, 1, 2, 3, 4, 5, 6],
    })
    db.add(biz)
    db.commit()
    db.refresh(biz)
    burger = Product(business_id=biz.id, name="Burger", unit="ea", lead_time_days=2)
    fries = Product(business_id=biz.id, name="Fries", unit="ea", lead_time_days=2)
    db.add_all([burger, fries])
    db.commit()
    db.refresh(burger)
    db.refresh(fries)
    return biz, burger, fries


@pytest.fixture()
def client(db, shop):
    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _tap_products(db, biz, burger, fries):
    """The owner tapped during service: customers, plus what they bought."""
    at = datetime(DAY.year, DAY.month, DAY.day, 13, 0)   # 13:00, inside open hours
    db.add_all([
        SaleEvent(business_id=biz.id, product_id=None, timestamp=at, quantity=45),
        SaleEvent(business_id=biz.id, product_id=burger.id, timestamp=at, quantity=36),
        SaleEvent(business_id=biz.id, product_id=fries.id, timestamp=at, quantity=22.5),
    ])
    db.commit()


def _product_totals(db, biz) -> dict[str, float]:
    rows = db.query(SaleEvent).filter(
        SaleEvent.business_id == biz.id, SaleEvent.product_id.isnot(None)
    ).all()
    names = {p.id: p.name for p in db.query(Product).filter_by(business_id=biz.id).all()}
    out: dict[str, float] = {}
    for r in rows:
        out[names[r.product_id]] = out.get(names[r.product_id], 0.0) + float(r.quantity)
    return out


# ── the core rule ────────────────────────────────────────────────────────────

def test_hours_only_submission_keeps_the_product_breakdown(client, db, shop, sim_clock):
    """Tapping products, then submitting hours-only counts, must preserve them."""
    biz, burger, fries = shop
    _tap_products(db, biz, burger, fries)
    assert _product_totals(db, biz) == {"Burger": 36.0, "Fries": 22.5}

    r = client.post("/sale-events/backfill-hourly", json={
        "date": DAY.isoformat(),
        "hours": [{"hour": 12, "customers": 22}, {"hour": 13, "customers": 26}],
    })
    assert r.status_code == 201, r.text

    assert _product_totals(db, biz) == {"Burger": 36.0, "Fries": 22.5}, (
        "a customers-only submission must not touch product rows"
    )
    body = r.json()
    assert body["kept_products"] == 2
    assert body["replaced_products"] == 0


def test_hours_only_submission_does_update_the_customer_counts(client, db, shop, sim_clock):
    """The half that SHOULD be replaced still is."""
    biz, burger, fries = shop
    _tap_products(db, biz, burger, fries)

    client.post("/sale-events/backfill-hourly", json={
        "date": DAY.isoformat(),
        "hours": [{"hour": 12, "customers": 22}, {"hour": 13, "customers": 26}],
    })
    hours = db.query(SaleEvent).filter(
        SaleEvent.business_id == biz.id, SaleEvent.product_id.is_(None)
    ).all()
    assert sum(float(h.quantity) for h in hours) == 48.0, "45 replaced by 22+26"
    assert len(hours) == 2, "the old single 45-customer row is gone, not added to"


def test_resubmitting_hours_stays_idempotent(client, db, shop, sim_clock):
    biz, burger, fries = shop
    payload = {"date": DAY.isoformat(),
               "hours": [{"hour": 12, "customers": 22}, {"hour": 13, "customers": 26}]}
    client.post("/sale-events/backfill-hourly", json=payload)
    client.post("/sale-events/backfill-hourly", json=payload)
    hours = db.query(SaleEvent).filter(
        SaleEvent.business_id == biz.id, SaleEvent.product_id.is_(None)
    ).all()
    assert sum(float(h.quantity) for h in hours) == 48.0, "no double-count"


# ── a submission that DOES carry products replaces them ──────────────────────

def test_submission_with_products_replaces_them(client, db, shop, sim_clock):
    biz, burger, fries = shop
    _tap_products(db, biz, burger, fries)

    r = client.post("/sale-events/backfill-hourly", json={
        "date": DAY.isoformat(),
        "hours": [{"hour": 12, "customers": 22}, {"hour": 13, "customers": 26}],
        "products": [{"product_id": burger.id, "units": 40},
                     {"product_id": fries.id, "units": 18}],
    })
    assert r.status_code == 201, r.text
    assert _product_totals(db, biz) == {"Burger": 40.0, "Fries": 18.0}
    assert r.json()["replaced_products"] == 2
    assert r.json()["kept_products"] == 0


def test_reimporting_the_same_day_with_products_does_not_double_count(client, db, shop, sim_clock):
    biz, burger, fries = shop
    payload = {
        "date": DAY.isoformat(),
        "hours": [{"hour": 12, "customers": 22}, {"hour": 13, "customers": 26}],
        "products": [{"product_id": burger.id, "units": 40},
                     {"product_id": fries.id, "units": 18}],
    }
    client.post("/sale-events/backfill-hourly", json=payload)
    client.post("/sale-events/backfill-hourly", json=payload)
    assert _product_totals(db, biz) == {"Burger": 40.0, "Fries": 18.0}


def test_a_product_from_another_business_is_rejected(client, db, shop, sim_clock):
    biz, burger, _fries = shop
    other = Business(name="Someone else", user_id="other-user", settings={})
    db.add(other)
    db.commit()
    db.refresh(other)
    theirs = Product(business_id=other.id, name="Not yours", unit="ea", lead_time_days=1)
    db.add(theirs)
    db.commit()
    db.refresh(theirs)

    r = client.post("/sale-events/backfill-hourly", json={
        "date": DAY.isoformat(),
        "hours": [{"hour": 12, "customers": 10}],
        "products": [{"product_id": theirs.id, "units": 5}],
    })
    assert r.status_code == 404


# ── the CSV product path (SaleRecord) must also be idempotent ────────────────

def test_reimporting_a_csv_with_product_columns_does_not_double_count(client, db, shop, sim_clock):
    """The importer writes per-product totals through POST /sales. That used to
    APPEND, so importing the same file twice doubled the day's sales — and with
    them the stock drawn down."""
    biz, burger, fries = shop
    dr = DayRecord(business_id=biz.id, date=DAY, customers=48)
    db.add(dr)
    db.commit()
    db.refresh(dr)

    def _import():
        for prod, units in ((burger, 40), (fries, 18)):
            r = client.post("/sales", json={
                "day_record_id": dr.id, "product_id": prod.id, "units_sold": units,
            })
            assert r.status_code == 201, r.text

    _import()
    _import()

    rows = db.query(SaleRecord).filter_by(day_record_id=dr.id).all()
    assert len(rows) == 2, f"one row per product per day, got {len(rows)}"
    assert {r.product_id: r.units_sold for r in rows} == {burger.id: 40.0, fries.id: 18.0}


def test_a_corrected_reimport_updates_rather_than_appends(client, db, shop, sim_clock):
    biz, burger, _fries = shop
    dr = DayRecord(business_id=biz.id, date=DAY, customers=48)
    db.add(dr)
    db.commit()
    db.refresh(dr)

    client.post("/sales", json={"day_record_id": dr.id, "product_id": burger.id, "units_sold": 40})
    client.post("/sales", json={"day_record_id": dr.id, "product_id": burger.id, "units_sold": 33})

    rows = db.query(SaleRecord).filter_by(day_record_id=dr.id, product_id=burger.id).all()
    assert len(rows) == 1
    assert rows[0].units_sold == 33.0, "the corrected figure wins"


# ── the preview the owner is shown before saving ─────────────────────────────

def test_preview_reports_what_exists_before_a_submission(client, db, shop, sim_clock):
    biz, burger, fries = shop
    _tap_products(db, biz, burger, fries)

    r = client.get("/sale-events/backfill-preview", params={"day": DAY.isoformat()})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["existing_hours"] == 1
    assert body["existing_hour_customers"] == 45.0
    assert [(p["product_name"], p["units"]) for p in body["existing_products"]] == [
        ("Burger", 36.0), ("Fries", 22.5),
    ]


def test_preview_is_empty_for_an_untouched_day(client, db, shop, sim_clock):
    r = client.get("/sale-events/backfill-preview", params={"day": "2026-03-01"})
    assert r.status_code == 200
    body = r.json()
    assert body["existing_hours"] == 0
    assert body["existing_products"] == []

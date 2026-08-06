"""Integration tests for /booked-counts and its wiring into GET /forecast.

Covers: upsert-in-place (no duplicates), listing, deletion, the
appointment_based settings gate, and that a booked count surfaces on the
matching forecast day only when the business has appointments turned on.
"""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_business
from app.db import get_db
from app.main import app


@pytest.fixture()
def bk_client(db, biz):
    """TestClient with get_db and get_business overridden — no JWT required."""
    def _db():
        yield db

    def _biz():
        return biz

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_business] = _biz
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


TARGET = str(date.today() + timedelta(days=2))


def test_upsert_creates_then_updates_in_place(bk_client):
    r1 = bk_client.put(f"/booked-counts/{TARGET}", json={"booked_count": 10})
    assert r1.status_code == 200
    assert r1.json() == {"date": TARGET, "booked_count": 10, "product_id": None}

    r2 = bk_client.put(f"/booked-counts/{TARGET}", json={"booked_count": 14})
    assert r2.status_code == 200
    assert r2.json()["booked_count"] == 14

    rows = bk_client.get("/booked-counts").json()
    assert len(rows) == 1  # updated in place, not duplicated
    assert rows[0]["booked_count"] == 14


def test_delete_booked_count(bk_client):
    bk_client.put(f"/booked-counts/{TARGET}", json={"booked_count": 5})
    r = bk_client.delete(f"/booked-counts/{TARGET}")
    assert r.status_code == 204
    assert bk_client.get("/booked-counts").json() == []


def test_negative_booked_count_rejected(bk_client):
    r = bk_client.put(f"/booked-counts/{TARGET}", json={"booked_count": -1})
    assert r.status_code == 422


def test_booked_count_surfaces_on_matching_forecast_day_when_appointment_based(bk_client):
    today = date.today()
    # 20 days of clean history with a booked count on every day, actual = booked + 3.
    for i in range(20, 0, -1):
        d = today - timedelta(days=i)
        booked = 10 + i
        bk_client.post("/day-records", json={"date": str(d), "customers": booked + 3})
        bk_client.put(f"/booked-counts/{d}", json={"booked_count": booked})

    target = today + timedelta(days=2)
    bk_client.put(f"/booked-counts/{target}", json={"booked_count": 12})

    # appointment_based is off by default — booked_count must not appear
    r = bk_client.get("/forecast")
    assert r.status_code == 200
    day = next((d for d in r.json()["days"] if d["date"] == str(target)), None)
    assert day is not None
    assert day["booked_count"] is None

    # Turn appointments on — the same date's forecast day now carries the booked count
    r = bk_client.patch("/businesses/me/settings", json={"appointment_based": True})
    assert r.status_code == 200
    assert r.json()["settings"]["appointment_based"] is True

    r = bk_client.get("/forecast")
    assert r.status_code == 200
    day = next((d for d in r.json()["days"] if d["date"] == str(target)), None)
    assert day is not None
    assert day["booked_count"] == 12


# ── per-service booked counts ────────────────────────────────────────────────

def _create_service(bk_client, name="Massage"):
    r = bk_client.post("/products", json={"name": name, "unit": "session", "product_type": "service"})
    assert r.status_code == 201
    return r.json()["id"]


def test_service_booked_count_scoped_by_product(bk_client):
    p1 = _create_service(bk_client, "Massage")
    p2 = _create_service(bk_client, "Haircut")

    bk_client.put(f"/booked-counts/{TARGET}?product_id={p1}", json={"booked_count": 7})
    bk_client.put(f"/booked-counts/{TARGET}?product_id={p2}", json={"booked_count": 3})

    p1_rows = bk_client.get(f"/booked-counts?product_id={p1}").json()
    assert p1_rows == [{"date": TARGET, "booked_count": 7, "product_id": p1}]

    p2_rows = bk_client.get(f"/booked-counts?product_id={p2}").json()
    assert p2_rows == [{"date": TARGET, "booked_count": 3, "product_id": p2}]

    # Whole-business list is untouched by per-service entries
    assert bk_client.get("/booked-counts").json() == []


def test_service_booked_count_upsert_in_place(bk_client):
    p1 = _create_service(bk_client)
    bk_client.put(f"/booked-counts/{TARGET}?product_id={p1}", json={"booked_count": 5})
    bk_client.put(f"/booked-counts/{TARGET}?product_id={p1}", json={"booked_count": 9})
    rows = bk_client.get(f"/booked-counts?product_id={p1}").json()
    assert len(rows) == 1
    assert rows[0]["booked_count"] == 9


def test_service_booked_count_delete(bk_client):
    p1 = _create_service(bk_client)
    bk_client.put(f"/booked-counts/{TARGET}?product_id={p1}", json={"booked_count": 5})
    r = bk_client.delete(f"/booked-counts/{TARGET}?product_id={p1}")
    assert r.status_code == 204
    assert bk_client.get(f"/booked-counts?product_id={p1}").json() == []


def test_deleting_product_cascades_service_booked_counts(bk_client, db):
    from app.models import ServiceBookedCount
    p1 = _create_service(bk_client)
    bk_client.put(f"/booked-counts/{TARGET}?product_id={p1}", json={"booked_count": 5})
    bk_client.delete(f"/products/{p1}")
    assert db.query(ServiceBookedCount).filter_by(product_id=p1).count() == 0


def test_forecast_prefers_summed_service_counts_over_whole_business_total(bk_client):
    today = date.today()
    for i in range(20, 0, -1):
        d = today - timedelta(days=i)
        booked = 10 + i
        bk_client.post("/day-records", json={"date": str(d), "customers": booked + 3})
        bk_client.put(f"/booked-counts/{d}", json={"booked_count": booked})

    target = today + timedelta(days=2)
    # Whole-business entry says 12, but two services sum to 20 — the sum should win.
    bk_client.put(f"/booked-counts/{target}", json={"booked_count": 12})
    p1 = _create_service(bk_client, "Massage")
    p2 = _create_service(bk_client, "Haircut")
    bk_client.put(f"/booked-counts/{target}?product_id={p1}", json={"booked_count": 15})
    bk_client.put(f"/booked-counts/{target}?product_id={p2}", json={"booked_count": 5})

    bk_client.patch("/businesses/me/settings", json={"appointment_based": True})
    r = bk_client.get("/forecast")
    day = next(d for d in r.json()["days"] if d["date"] == str(target))
    assert day["booked_count"] == 20


def test_product_forecast_surfaces_booked_count_for_service(bk_client):
    bk_client.patch("/businesses/me/settings", json={"appointment_based": True})
    p1 = _create_service(bk_client, "Massage")

    today = date.today()
    for i in range(10, 0, -1):
        d = today - timedelta(days=i)
        booked = 3 + (i % 4)
        day_row = bk_client.post("/day-records", json={"date": str(d), "customers": 10}).json()
        bk_client.post("/sales", json={"day_record_id": day_row["id"], "product_id": p1, "units_sold": booked + 1})
        bk_client.put(f"/booked-counts/{d}?product_id={p1}", json={"booked_count": booked})

    target = today + timedelta(days=2)
    bk_client.put(f"/booked-counts/{target}?product_id={p1}", json={"booked_count": 6})

    r = bk_client.get(f"/product-forecast?product_id={p1}")
    assert r.status_code == 200
    item = r.json()["products"][0]
    assert item["status"] == "ok"
    day = next(d for d in item["days"] if d["date"] == str(target))
    assert day["booked_count"] == 6

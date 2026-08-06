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
    assert r1.json() == {"date": TARGET, "booked_count": 10}

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

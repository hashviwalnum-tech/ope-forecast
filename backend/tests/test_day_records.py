"""Tests for POST /day-records duplicate detection, CORS on error responses, and PUT overwrite."""
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_business
from app.db import get_db
from app.main import app

# Dates within the free-tier 1-year history window (today is 2026-06-07).
DATE_A = "2025-09-10"
DATE_B = "2025-09-11"


@pytest.fixture()
def day_client(db, biz):
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


def test_create_day_record_success(day_client):
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 42})
    assert r.status_code == 201
    data = r.json()
    assert data["customers"] == 42
    assert data["date"] == DATE_A


def test_different_dates_both_allowed(day_client):
    r1 = day_client.post("/day-records", json={"date": DATE_A, "customers": 10})
    r2 = day_client.post("/day-records", json={"date": DATE_B, "customers": 20})
    assert r1.status_code == 201
    assert r2.status_code == 201


def test_duplicate_date_returns_409(day_client):
    """Second POST for the same date must return 409, not crash with 500."""
    day_client.post("/day-records", json={"date": DATE_A, "customers": 10})
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 20})
    assert r.status_code == 409
    assert "already exists" in r.json()["detail"].lower()


def test_409_includes_cors_header(day_client):
    """A 409 must include Access-Control-Allow-Origin so the browser sees the real
    error instead of a misleading 'CORS error' that disguises backend crashes."""
    origin = "http://localhost:5173"
    day_client.post(
        "/day-records",
        json={"date": DATE_A, "customers": 10},
        headers={"Origin": origin},
    )
    r = day_client.post(
        "/day-records",
        json={"date": DATE_A, "customers": 20},
        headers={"Origin": origin},
    )
    assert r.status_code == 409
    assert r.headers.get("access-control-allow-origin") == origin


def test_put_overwrites_existing_record(day_client):
    """PUT /day-records/{id} with new customers succeeds — this is the overwrite path
    the frontend uses when the user confirms they want to replace an existing record."""
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 10})
    assert r.status_code == 201
    record_id = r.json()["id"]
    r2 = day_client.put(f"/day-records/{record_id}", json={"customers": 99})
    assert r2.status_code == 200
    assert r2.json()["customers"] == 99

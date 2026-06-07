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


# ── Hourly consistency warning ─────────────────────────────────────────────────

def test_hourly_warning_when_events_exceed_total(day_client, db, biz):
    """When hourly SaleEvents (product_id=None) sum to more than the daily
    customer total, the endpoint must return a non-None warning string.

    Root cause of the previous non-implementation:
    BackfillForm submits hourly SaleEvents AFTER the day record is created,
    so the server-side warning check (run at creation time) always sees zero
    hourly data.  The real guard is frontend reconciliation before submit;
    this test covers the server-side path used when live tap-sales exist."""
    import datetime
    from app.models import SaleEvent

    # Create 15 customer taps for DATE_A — each is a product_id=None SaleEvent
    for minute in range(15):
        db.add(SaleEvent(
            business_id=biz.id,
            product_id=None,
            timestamp=datetime.datetime(2025, 9, 10, 10, minute, 0),
            quantity=1.0,
        ))
    db.commit()

    # Create day record with only 10 customers — less than the 15 tap events
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 10})
    assert r.status_code == 201
    data = r.json()
    assert data["warning"] is not None, "Expected a warning when hourly data exceeds daily total"
    assert "15" in data["warning"], f"Warning should mention the 15-customer hourly total; got: {data['warning']}"


def test_no_warning_when_events_under_total(day_client, db, biz):
    """When hourly SaleEvents are fewer than the daily total, no warning is returned
    (the gap is simply treated as unattributed time — this is fine)."""
    import datetime
    from app.models import SaleEvent

    # Only 5 tap events, but daily total is 10 — a gap of 5 unattributed customers
    for minute in range(5):
        db.add(SaleEvent(
            business_id=biz.id,
            product_id=None,
            timestamp=datetime.datetime(2025, 9, 10, 10, minute, 0),
            quantity=1.0,
        ))
    db.commit()

    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 10})
    assert r.status_code == 201
    assert r.json()["warning"] is None


def test_no_warning_when_no_hourly_events(day_client):
    """No warning when there are no hourly SaleEvents at all."""
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 50})
    assert r.status_code == 201
    assert r.json()["warning"] is None

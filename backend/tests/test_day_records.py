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


# ── Import integrity: stored value must exactly match what was sent ────────────

def test_import_stores_exact_customer_value(day_client):
    """The stored customers value must equal the value passed in the POST body.

    This is the regression guard for the data-corruption bug where the
    hours-vs-total reconciliation (frontend) was overwriting an explicitly
    entered customer total with the hourly sum.  The backend stores whatever
    customers value it receives — if that value is correct (the frontend fix
    ensures the user's explicit entry is sent), the stored value must match.
    """
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 70})
    assert r.status_code == 201
    assert r.json()["customers"] == 70, (
        "Stored customers value must equal the value sent in the POST body."
    )


def test_import_backfill_does_not_overwrite_customer_total(day_client, db, biz):
    """After calling backfill-hourly for a day, the DayRecord.customers must
    remain unchanged.  Historically the backfill endpoint touched only SaleEvents;
    this test confirms it never overwrites the day-record customer count.
    """
    import datetime as dt
    # Create a day record with a known customer count
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 70})
    assert r.status_code == 201
    record_id = r.json()["id"]

    # Backfill hourly SaleEvents whose sum (89) is greater than 70
    r2 = day_client.post(
        "/sale-events/backfill-hourly",
        json={"date": DATE_A, "hours": [{"hour": 9, "customers": 50}, {"hour": 10, "customers": 39}]},
    )
    assert r2.status_code == 201

    # The DayRecord.customers must still be 70, not 89
    from app.models import DayRecord
    stored = db.get(DayRecord, record_id)
    assert stored.customers == 70, (
        f"backfill-hourly must not overwrite DayRecord.customers; "
        f"expected 70, got {stored.customers}"
    )


def test_import_multiple_rows_all_stored_correctly(day_client):
    """Simulate importing multiple days: every stored value must match the input."""
    rows = [
        ("2025-08-01", 42),
        ("2025-08-02", 70),
        ("2025-08-03", 100),
        ("2025-08-04", 5),
    ]
    stored = {}
    for date_str, customers in rows:
        r = day_client.post("/day-records", json={"date": date_str, "customers": customers})
        assert r.status_code == 201
        stored[date_str] = r.json()["customers"]

    for date_str, expected in rows:
        assert stored[date_str] == expected, (
            f"Row {date_str}: expected {expected}, stored {stored[date_str]}"
        )


# ── Undo override ──────────────────────────────────────────────────────────────

def test_undo_not_available_before_any_update(day_client):
    """A freshly created record has no previous version — undo returns 404."""
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 10})
    assert r.status_code == 201
    record_id = r.json()["id"]
    # No previous version yet
    assert r.json()["prev_customers"] is None
    r2 = day_client.post(f"/day-records/{record_id}/undo")
    assert r2.status_code == 404


def test_undo_restores_previous_customer_count(day_client):
    """After a PUT overwrites a record, POST .../undo restores the old value."""
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 50})
    assert r.status_code == 201
    record_id = r.json()["id"]

    # Overwrite
    r2 = day_client.put(f"/day-records/{record_id}", json={"customers": 99})
    assert r2.status_code == 200
    assert r2.json()["customers"] == 99
    assert r2.json()["prev_customers"] == 50

    # Undo → back to 50
    r3 = day_client.post(f"/day-records/{record_id}/undo")
    assert r3.status_code == 200
    assert r3.json()["customers"] == 50


def test_undo_of_undo_re_applies_overwrite(day_client):
    """A second undo re-applies the overwritten value (swap is bidirectional)."""
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 50})
    record_id = r.json()["id"]

    day_client.put(f"/day-records/{record_id}", json={"customers": 99})

    # First undo: back to 50
    day_client.post(f"/day-records/{record_id}/undo")

    # Second undo: re-apply 99
    r3 = day_client.post(f"/day-records/{record_id}/undo")
    assert r3.status_code == 200
    assert r3.json()["customers"] == 99

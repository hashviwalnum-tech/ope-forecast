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


# ── Hourly reconciliation (hours-vs-total rule wired into create/update) ───────

def test_reconciliation_hours_exceed_manual_uses_hours_sum(day_client, db, biz):
    """When open-hours SaleEvents sum to MORE than the manual customer total,
    the stored customers must equal the SaleEvent sum (hours win — spec §9 case 1).

    Reconciliation is now wired into create/update so the correction happens
    automatically with no warning needed (the inconsistency is resolved, not warned)."""
    import datetime
    from app.models import SaleEvent

    # Create 15 customer taps at hour 10 (within default open-hours 6–22)
    for minute in range(15):
        db.add(SaleEvent(
            business_id=biz.id,
            product_id=None,
            timestamp=datetime.datetime(2025, 9, 10, 10, minute, 0),
            quantity=1.0,
        ))
    db.commit()

    # Enter manual total of 10 — less than the 15 tap events
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 10})
    assert r.status_code == 201
    data = r.json()
    # Reconciliation must have promoted the customers value to the SaleEvent sum
    assert data["customers"] == 15, (
        f"hours_sum (15) > manual (10) → hours win; expected customers=15, got {data['customers']}"
    )
    # No warning expected because the inconsistency was resolved automatically
    assert data["warning"] is None, "No warning expected after reconciliation resolves the gap"


def test_reconciliation_closed_hour_events_excluded(day_client, db, biz):
    """SaleEvents outside open hours must NOT count toward the hours sum.

    Business is configured 9–17.  Taps at hour 22 (closed) must be ignored;
    taps at hour 10 (open) count.  With open-hours sum = 5 and manual total = 10,
    hours_sum < manual, so manual wins (case 3).
    """
    import datetime
    from app.models import SaleEvent

    biz.settings = {"opening_hour": 9, "closing_hour": 17}
    db.commit()

    # 5 taps at hour 10 (open) + 50 taps at hour 22 (closed)
    for minute in range(5):
        db.add(SaleEvent(
            business_id=biz.id,
            product_id=None,
            timestamp=datetime.datetime(2025, 9, 10, 10, minute, 0),
            quantity=1.0,
        ))
    for minute in range(50):
        db.add(SaleEvent(
            business_id=biz.id,
            product_id=None,
            timestamp=datetime.datetime(2025, 9, 10, 22, minute, 0),
            quantity=1.0,
        ))
    db.commit()

    # Manual total is 10; open-hours sum is 5 (closed-hour 50 must be excluded)
    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 10})
    assert r.status_code == 201
    data = r.json()
    assert data["customers"] == 10, (
        f"Closed-hour taps must not inflate total; expected 10, got {data['customers']}"
    )


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


# ── Local-timezone bucketing (bug fix regression guards) ───────────────────────

def test_reconciliation_uses_local_hour_not_utc_hour(day_client, db, biz):
    """With a non-UTC business timezone, open-hours filtering must use the tap's
    LOCAL hour, not its raw stored UTC hour.

    Business is Asia/Jerusalem (UTC+3 in September), open 9-17 local.
    - 5 taps stored at UTC hour 7 == local hour 10 (open) → must count.
    - 50 taps stored at UTC hour 15 == local hour 18 (closed) → must NOT count,
      even though raw UTC hour 15 would incorrectly look "open" (9-17) if the
      code compared the stored UTC hour directly instead of converting first.
    """
    import datetime
    from app.models import SaleEvent

    biz.settings = {"timezone": "Asia/Jerusalem", "opening_hour": 9, "closing_hour": 17}
    db.commit()

    for minute in range(5):
        db.add(SaleEvent(
            business_id=biz.id, product_id=None,
            timestamp=datetime.datetime(2025, 9, 10, 7, minute, 0),
            quantity=1.0,
        ))
    for minute in range(50):
        db.add(SaleEvent(
            business_id=biz.id, product_id=None,
            timestamp=datetime.datetime(2025, 9, 10, 15, minute, 0),
            quantity=1.0,
        ))
    db.commit()

    r = day_client.post("/day-records", json={"date": DATE_A, "customers": 10})
    assert r.status_code == 201, r.text
    assert r.json()["customers"] == 10, (
        "Local hour 18 (closed) must not count toward the open-hours sum even "
        "though its raw UTC hour (15) falls inside 9-17; manual total should stand."
    )


def test_rollup_tap_days_assigns_local_day_not_utc_day(db, biz):
    """A sale stored a few hours before UTC midnight can already be the
    business's NEXT local calendar day — rollup must file it under that
    local day's DayRecord, not the UTC day's.

    2024-08-01 21:30 UTC == 2024-08-02 00:30 IDT (Asia/Jerusalem, UTC+3 in
    August) — just after local midnight, so the local day is Aug 2, not
    the UTC day (Aug 1). Dates are historical so they're always "in the past"
    regardless of when this test runs. opening_hour == closing_hour (0, 0)
    configures a 24-hour-open business so the 00:30 local tap isn't also
    excluded by the (unrelated) open-hours filter.
    """
    import datetime
    from app.models import SaleEvent
    from app.api.day_records import rollup_tap_days

    biz.settings = {"timezone": "Asia/Jerusalem", "opening_hour": 0, "closing_hour": 0}
    db.commit()

    db.add(SaleEvent(
        business_id=biz.id, product_id=None,
        timestamp=datetime.datetime(2024, 8, 1, 21, 30),
        quantity=1.0,
    ))
    db.commit()

    created = rollup_tap_days(db, biz)
    assert created == [datetime.date(2024, 8, 2)], (
        f"Expected the sale to roll up under the local day 2024-08-02, got {created}"
    )

    from app.models import DayRecord
    record = db.query(DayRecord).filter_by(business_id=biz.id).first()
    assert record.date == datetime.date(2024, 8, 2)
    assert record.customers == 1


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

"""Tests for /sale-events: today-summary local-timezone bucketing, timestamp
serialization, and local-timezone-aware hourly backfill.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_business
from app.db import get_db
from app.main import app
from app.models import SaleEvent


@pytest.fixture()
def sale_client(db, biz):
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


def test_today_summary_reports_business_timezone(sale_client, biz, db):
    biz.settings = {"timezone": "Asia/Jerusalem"}
    db.commit()
    r = sale_client.get("/sale-events/today")
    assert r.status_code == 200, r.text
    assert r.json()["timezone"] == "Asia/Jerusalem"


def test_today_summary_defaults_timezone_to_utc(sale_client):
    r = sale_client.get("/sale-events/today")
    assert r.status_code == 200, r.text
    assert r.json()["timezone"] == "UTC"


def test_recent_tap_timestamp_serializes_with_utc_offset(sale_client):
    """The frontend does `new Date(tap.timestamp)` — a naive-looking string with
    no offset gets misread as local browser time instead of UTC. The API must
    always include an explicit offset."""
    r = sale_client.post("/sale-events", json={"product_id": None, "quantity": 1})
    assert r.status_code == 201, r.text

    r2 = sale_client.get("/sale-events/today")
    assert r2.status_code == 200, r2.text
    taps = r2.json()["recent_taps"]
    assert len(taps) == 1
    ts = taps[0]["timestamp"]
    assert ts.endswith("Z") or "+00:00" in ts or ts[-6] in "+-", (
        f"timestamp {ts!r} has no explicit UTC offset — a browser will parse it as local time"
    )


def test_today_hour_rollup_uses_local_hour_not_utc_hour(sale_client, biz, db):
    """A tap stored at UTC hour 21 (Asia/Jerusalem local hour 0) must appear
    under local hour 0 in the end-of-day chart, not raw UTC hour 21.

    This also proves the /today window itself is the LOCAL day: with the
    server clock frozen conceptually at "now", we insert an event whose UTC
    timestamp is today's UTC date but query as of that same moment — the
    important assertion is the returned hour bucket, which only makes sense
    if local-hour conversion (not raw UTC hour) was applied.
    """
    biz.settings = {"timezone": "Asia/Jerusalem"}
    db.commit()

    now_utc = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    db.add(SaleEvent(business_id=biz.id, product_id=None, timestamp=now_utc, quantity=1.0))
    db.commit()

    r = sale_client.get("/sale-events/today")
    assert r.status_code == 200, r.text
    data = r.json()
    expected_local_hour = (now_utc + datetime.timedelta(hours=3)).hour
    hours = {h["hour"] for h in data["hours"]}
    assert expected_local_hour in hours, (
        f"Expected local hour {expected_local_hour} in {hours} "
        f"(UTC hour was {now_utc.hour}) — hour rollup must use local time"
    )


def test_backfill_hourly_stores_local_hour_converted_to_utc(sale_client, biz, db):
    """backfill-hourly's `hour` is a LOCAL hour read off a register. It must be
    converted to UTC before storage so it lines up with live-tap SaleEvents
    (which are stored as true UTC), not stored as a naive local-as-if-UTC value.
    """
    biz.settings = {"timezone": "Asia/Jerusalem"}
    db.commit()

    r = sale_client.post("/sale-events/backfill-hourly", json={
        "date": "2025-09-10",
        "hours": [{"hour": 10, "customers": 5}],
    })
    assert r.status_code == 201, r.text

    stored = db.query(SaleEvent).filter_by(business_id=biz.id).all()
    assert len(stored) == 1
    # Local 10:00 IDT (UTC+3) on 2025-09-10 == 07:00 UTC — NOT stored as a
    # naive 10:00 value (which would be a 3-hour bug when later re-localized).
    assert stored[0].timestamp == datetime.datetime(2025, 9, 10, 7, 0, 0)


def test_backfill_hourly_resubmission_clears_only_that_local_day(sale_client, biz, db):
    """Re-submitting backfill for the same local day must replace its own
    events without touching the correctly-converted UTC window."""
    biz.settings = {"timezone": "Asia/Jerusalem"}
    db.commit()

    sale_client.post("/sale-events/backfill-hourly", json={
        "date": "2025-09-10",
        "hours": [{"hour": 10, "customers": 5}],
    })
    r2 = sale_client.post("/sale-events/backfill-hourly", json={
        "date": "2025-09-10",
        "hours": [{"hour": 11, "customers": 8}],
    })
    assert r2.status_code == 201, r2.text

    stored = db.query(SaleEvent).filter_by(business_id=biz.id).all()
    assert len(stored) == 1, "Resubmitting must replace, not append"
    assert stored[0].quantity == 8

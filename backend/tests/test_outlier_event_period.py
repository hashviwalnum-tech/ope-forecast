"""
Regression test: outlier detection must run INSIDE event/ad periods.

Spec §6: "Outlier detection still runs DURING event/ad periods — a day can be
unusually low/high even for an event period, and the owner must STILL get the
choice to flag it as a fluke even while an event is running (don't suppress the
fluke prompt just because a period is tagged)."
"""
import pytest
from datetime import date

from app.api.deps import get_business, get_tier
from app.engine.limits import Tier
from app.db import get_db
from app.main import app
from app.models import DayRecord, Period
from fastapi.testclient import TestClient


@pytest.fixture()
def outlier_client(db, biz):
    """TestClient with get_db and get_business overridden — no JWT required."""
    def _db():
        yield db

    def _biz():
        return biz

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_business] = _biz
    app.dependency_overrides[get_tier] = lambda: Tier('free')
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


def test_low_day_inside_event_period_still_flagged(outlier_client, db, biz):
    """A day inside a tagged event period that is an extreme outlier must still
    be included in the fluke-detection candidate set and returned as a flag.

    Before the fix: det_records filtered out event-period dates, so no fluke
    prompt was ever shown for those days even when dramatically anomalous.
    """
    # Build at least MIN_RECORDS (14) day records — required before outlier detection runs.
    # Use 7 normal Mondays (MIN_SAME_WEEKDAY = 6 for leave-one-out) + 8 filler Tuesdays.
    normal_mondays = [
        date(2025, 10, 6),
        date(2025, 10, 13),
        date(2025, 10, 20),
        date(2025, 10, 27),
        date(2025, 11, 3),
        date(2025, 11, 10),
    ]
    for d in normal_mondays:
        db.add(DayRecord(business_id=biz.id, date=d, customers=100))

    # Filler Tuesdays to reach the 14-record minimum
    filler_tuesdays = [
        date(2025, 10, 7),
        date(2025, 10, 14),
        date(2025, 10, 21),
        date(2025, 10, 28),
        date(2025, 11, 4),
        date(2025, 11, 11),
        date(2025, 11, 18),
        date(2025, 11, 25),
    ]
    for d in filler_tuesdays:
        db.add(DayRecord(business_id=biz.id, date=d, customers=90))

    # One Monday with an extreme low — clearly an outlier (2 vs usual 100)
    low_monday = date(2025, 11, 17)
    db.add(DayRecord(business_id=biz.id, date=low_monday, customers=2))

    # Tag that low Monday as inside an event period
    db.add(Period(
        business_id=biz.id,
        start_date=low_monday,
        end_date=low_monday,
        type="event",
        label="Test Event",
    ))
    db.commit()

    r = outlier_client.get("/outliers")
    assert r.status_code == 200
    flags = r.json().get("flags", [])
    flagged_dates = {f["date"] for f in flags}

    assert str(low_monday) in flagged_dates, (
        f"{low_monday} (2 customers during a 100-customer-average event period) "
        "must still appear as an outlier flag so the owner can decide whether it's "
        "a fluke or an underperforming event."
    )

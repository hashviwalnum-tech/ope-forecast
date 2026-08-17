"""
FINDING F-028: growth was being reported as seasonality.

The "coming up" insight compared last year's month against the owner's CURRENT
pace, so a business that had simply grown saw every future month announced as
"typically a slower month".  On the simulated restaurant — which grew about 23%
over the year and has no monthly seasonality at all — it confidently announced
three consecutive slower months, each 20-25% down.  Spec §1.6 requires these
insights to be "true, data-driven, no fabrication".

The comparison is now against the level the business was running at AROUND THAT
TIME, which cancels the trend out and leaves only the seasonal shape.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models import Business, DayRecord
from app.models.subscription import Subscription

USER = "seasonal-insight-user"
TODAY = date(2026, 8, 1)


@pytest.fixture()
def sim_clock(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    clock.freeze(datetime(2026, 8, 1, 20, 0, tzinfo=timezone.utc))
    yield
    clock.unfreeze()


def _client(db):
    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


def _business(db, shape) -> Business:
    """Two years of daily history; `shape(day_index, d)` returns the customers."""
    # A genuinely paying subscriber — the free tier caps history at one year,
    # and the tier is resolved from the subscription on every request.
    db.add(Subscription(user_id=USER, tier="premium", subscription_status="active"))
    biz = Business(name="Test", user_id=USER, settings={
        "tier": "premium", "timezone": "UTC", "opening_days": [0, 1, 2, 3, 4, 5, 6],
    })
    db.add(biz)
    db.commit()
    db.refresh(biz)
    start = TODAY - timedelta(days=730)
    for i in range(730):
        d = start + timedelta(days=i)
        db.add(DayRecord(business_id=biz.id, date=d, customers=int(shape(i, d))))
    db.commit()
    return biz


def _alerts(db):
    with _client(db) as c:
        body = c.get("/insights").json()
    app.dependency_overrides.clear()
    return body.get("seasonal_alerts") or []


def test_steady_growth_is_not_reported_as_seasonality(db, sim_clock):
    """A business that has simply grown 25% must not be told any month is
    'typically slower' — that was the false claim this replaced."""
    _business(db, lambda i, d: 400 * (1.0 + 0.25 * i / 730))
    assert _alerts(db) == []


def test_a_real_seasonal_dip_is_still_caught_despite_growth(db, sim_clock):
    """Growth AND a genuine 30% October dip: the dip must still surface."""
    def shape(i, d):
        base = 400 * (1.0 + 0.25 * i / 730)
        return base * (0.70 if d.month == 10 else 1.0)

    _business(db, shape)
    alerts = _alerts(db)
    october = [a for a in alerts if a["month_name"].startswith("Oct")]
    assert october, f"a real October dip must be surfaced; got {[a['month_name'] for a in alerts]}"
    a = october[0]
    assert a["direction"] == "quieter"
    assert 20 <= a["pct_difference"] <= 40, a["pct_difference"]


def test_the_expected_pace_applies_the_seasonal_shape_to_todays_level(db, sim_clock):
    """The number the owner is told to plan for must be based on where they are
    NOW, scaled by the season — not on last year's raw figure."""
    def shape(i, d):
        base = 400 * (1.0 + 0.25 * i / 730)
        return base * (0.70 if d.month == 10 else 1.0)

    _business(db, shape)
    a = next(x for x in _alerts(db) if x["month_name"].startswith("Oct"))
    assert a["expected_pace"] is not None
    # ~30% below today's pace, and well above last year's raw October figure.
    assert a["expected_pace"] < a["current_pace"]
    assert a["expected_pace"] > a["last_year_avg"], (
        "the business has grown, so this October should be busier than last "
        "October even though October is its quiet month"
    )


def test_a_flat_business_with_no_seasonality_says_nothing(db, sim_clock):
    _business(db, lambda i, d: 500)
    assert _alerts(db) == []


# ── FINDING F-029: the history view must show the owner's actual history ─────

def test_trends_counts_every_logged_day_including_promo_days(db, sim_clock):
    """The trends view reused the FORECASTING baseline, which strips out every
    day inside a tagged ad or event.  On the simulated year that dropped 55 real
    trading days, reported "256 days logged" against the owner's 311, and drew
    the monthly trend for a business that had never run a promotion."""
    from app.models import Period

    biz = _business(db, lambda i, d: 500)
    # Tag a fortnight as an event, and make those days genuinely busier.
    start = TODAY - timedelta(days=60)
    end = start + timedelta(days=13)
    db.add(Period(business_id=biz.id, start_date=start, end_date=end,
                  type="event", label="Festival"))
    for r in db.query(DayRecord).filter(
        DayRecord.business_id == biz.id,
        DayRecord.date >= start, DayRecord.date <= end,
    ).all():
        r.customers = 900
    db.commit()

    with _client(db) as c:
        body = c.get("/monthly-summary").json()
    app.dependency_overrides.clear()

    assert body["n_total_days"] == 730, (
        f"every logged day belongs in the owner's history, got {body['n_total_days']}"
    )
    dates = {p["date"] for p in body["history_points"]}
    assert start.isoformat() in dates, "event days must not appear as gaps"
    assert any(p["customers"] == 900 for p in body["history_points"]), (
        "history must show what actually happened, not a promo-free counterfactual"
    )


def test_trends_still_respects_days_the_owner_marked_as_flukes(db, sim_clock):
    """The owner's own instruction is honoured — that is not the same as
    silently removing days they never asked to hide."""
    biz = _business(db, lambda i, d: 500)
    row = db.query(DayRecord).filter_by(business_id=biz.id).first()
    row.outlier_status = "excluded"
    db.commit()

    with _client(db) as c:
        body = c.get("/monthly-summary").json()
    app.dependency_overrides.clear()
    assert body["n_total_days"] == 729

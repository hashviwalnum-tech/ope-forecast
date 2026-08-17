"""
Every screen that shows an accuracy number, or names a peak hour, must agree.

Three surfaces used to compute accuracy independently and disagreed: the
Accuracy screen scored the seasonal-naive model on its own (13.7 %), Insights
scored the seven-days-ahead forecast (11.2 %), and the truth was 10.2 %. Two
screens also named different peak hours when two hours were within half a
customer of each other, because one ranked on the raw average and the other on
the rounded figure it displayed.

Each was individually defensible. Together they destroy confidence in every
number in the app.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models import Business, DayRecord, ForecastRun, SaleEvent
from app.models.subscription import Subscription

USER = "sot-user"
TODAY = date(2026, 6, 1)


@pytest.fixture()
def sim_clock(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    clock.freeze(datetime(2026, 6, 1, 20, 0, tzinfo=timezone.utc))
    yield
    clock.unfreeze()


@pytest.fixture()
def seeded(db):
    """A business with a year of days, forecasts recorded for each, and taps."""
    db.add(Subscription(user_id=USER, tier="premium", subscription_status="active"))
    biz = Business(name="Agreement Cafe", user_id=USER, settings={
        "tier": "premium", "timezone": "UTC",
        "opening_hour": 9, "closing_hour": 17,
        "opening_days": [0, 1, 2, 3, 4, 5, 6],
    })
    db.add(biz)
    db.commit()
    db.refresh(biz)

    for i in range(200):
        d = TODAY - timedelta(days=200 - i)
        actual = 400 + (i % 7) * 20 + (i % 5) * 11
        db.add(DayRecord(business_id=biz.id, date=d, customers=actual))
        # Two forecasts per day: a stale 7-day-ahead one and a fresher next-day
        # one. Only the fresher should ever be scored.
        db.add(ForecastRun(
            business_id=biz.id, target_date=d,
            created_at=datetime.combine(d - timedelta(days=7), datetime.min.time()),
            predicted_value=actual - 90, interval_low=0, interval_high=0, model_weights={},
        ))
        db.add(ForecastRun(
            business_id=biz.id, target_date=d,
            created_at=datetime.combine(d - timedelta(days=1), datetime.min.time()),
            predicted_value=actual - 12, interval_low=0, interval_high=0, model_weights={},
        ))
        # Hourly taps: 12:00 and 13:00 nearly tied, which is the case that made
        # two screens name different peak hours.
        for hour, n in ((10, 40), (12, 61), (13, 61.4), (15, 45)):
            db.add(SaleEvent(
                business_id=biz.id, product_id=None,
                timestamp=datetime.combine(d, datetime.min.time()) + timedelta(hours=hour),
                quantity=n,
            ))
    db.commit()
    return biz


@pytest.fixture()
def client(db, seeded):
    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── accuracy ─────────────────────────────────────────────────────────────────

def test_accuracy_and_insights_report_the_same_error(client):
    """The number an owner reads must not depend on which screen they opened."""
    acc = client.get("/accuracy").json()
    ins = client.get("/insights").json()

    assert acc["status"] == "ok"
    assert acc["mape"] is not None
    assert ins["forecast_accuracy_mape"] is not None

    # Both read the same log; the Accuracy screen shows a recent-90-day snapshot
    # and Insights the whole history, so they need not be identical to the
    # decimal — but they must be describing the same thing, closely.
    assert abs(acc["mape"] - ins["forecast_accuracy_mape"]) < 1.0, (
        f"Accuracy says {acc['mape']}%, Insights says {ins['forecast_accuracy_mape']}%"
    )


def test_accuracy_scores_the_freshest_forecast_not_the_oldest(client):
    """Each day here has a stale 7-day-ahead forecast (90 low) and a fresh
    next-day one (12 low). The owner was looking at the fresh one."""
    acc = client.get("/accuracy").json()
    assert acc["measured_from"] == "measured"
    assert acc["mad"] == pytest.approx(12.0, abs=0.5), (
        "scoring the stale seven-days-ahead forecast would give ~90"
    )


def test_insights_scores_the_freshest_forecast_too(client):
    ins = client.get("/insights").json()
    # ~12 off a ~440 mean is ~2.7%; the stale forecast would be ~20%.
    assert ins["forecast_accuracy_mape"] < 6.0


def test_accuracy_comes_from_the_stored_forecast_log(client, db, seeded):
    """Delete the recorded forecasts and the measured figure must go away rather
    than being silently re-derived from some other calculation."""
    db.query(ForecastRun).delete()
    db.commit()
    acc = client.get("/accuracy").json()
    assert acc.get("measured_from") in (None, "estimated"), (
        "with no recorded forecasts it must say so, not invent a number"
    )


# ── peak hour ────────────────────────────────────────────────────────────────

def test_every_screen_names_the_same_peak_hour(client):
    """12:00 and 13:00 are within half a customer of each other — exactly the
    near-tie that used to make Insights and the busy-hours chart disagree."""
    hourly = client.get("/hourly-analytics").json()
    ins = client.get("/insights").json()

    assert hourly["status"] == "ok"
    chart_peak = max(hourly["hours"], key=lambda h: h["avg_taps"])["hour"]
    insights_peak = ins["peak_hour"]["hour"]

    assert chart_peak == insights_peak, (
        f"busy-hours chart says {chart_peak}, Insights says {insights_peak}"
    )


def test_the_hourly_profile_itself_is_shared(client):
    """The per-hour figures on both screens come from one computation."""
    hourly = client.get("/hourly-analytics").json()
    ins = client.get("/insights").json()
    by_hour = {h["hour"]: h["avg_taps"] for h in hourly["hours"]}
    peak = ins["peak_hour"]
    assert peak["hour"] in by_hour
    assert round(peak["avg_taps"]) == by_hour[peak["hour"]], (
        "Insights and the chart must be quoting the same average for that hour"
    )


def test_quietest_hour_also_agrees_with_the_chart(client):
    hourly = client.get("/hourly-analytics").json()
    ins = client.get("/insights").json()
    by_hour = {h["hour"]: h["avg_taps"] for h in hourly["hours"]}
    quiet = ins.get("quietest_hour")
    if quiet is not None:
        assert quiet["hour"] == min(by_hour, key=lambda h: (by_hour[h], h))

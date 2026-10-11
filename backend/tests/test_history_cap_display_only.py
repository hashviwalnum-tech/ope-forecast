"""The free plan's one-year limit is on what the owner SEES, never on what the
forecast LEARNS from.

Spec §10's iron rule: nothing that affects forecast accuracy is gated. The
limit used to trim the forecast's training data too, so a free business past
its first year lost its year-ago comparison at exactly the point it became
useful. These pin both halves: the forecast keeps every day; Past days, the
monthly history and the forecast history still stop at one year.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api.analytics import _clean_records
from app.api.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models import Business, DayRecord, ForecastRun

USER = "history-display-user"
OLD = date(2024, 6, 3)      # nearly two years before "today" below
RECENT = date(2026, 2, 2)


@pytest.fixture()
def sim_clock(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    yield
    clock.unfreeze()


@pytest.fixture()
def free_biz(db, sim_clock):
    """A free business (trial long over) with one day from two years ago."""
    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as c:
        clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
        biz_id = c.post("/businesses", json={"name": "Old Cafe"}).json()["id"]
        clock.freeze(datetime(2026, 3, 1, 20, 0, tzinfo=timezone.utc))   # trial over
        for d in (OLD, RECENT):
            db.add(DayRecord(business_id=biz_id, date=d, customers=40))
            db.add(ForecastRun(business_id=biz_id, target_date=d, predicted_value=41, interval_low=35, interval_high=47,
                               created_at=datetime(d.year, d.month, d.day)))
        db.commit()
        assert c.get("/businesses/me").json()["tier"] == "free"
        yield c, db.get(Business, biz_id)
    app.dependency_overrides.clear()


def test_the_forecast_learns_from_days_older_than_a_year(free_biz, db):
    _, biz = free_biz
    dates = {r.date for r in _clean_records(db, biz)}
    assert OLD in dates and RECENT in dates


def test_past_days_still_shows_only_the_last_year(free_biz):
    c, _ = free_biz
    shown = {r["date"] for r in c.get("/day-records").json()}
    assert RECENT.isoformat() in shown
    assert OLD.isoformat() not in shown


def test_monthly_history_still_shows_only_the_last_year(free_biz):
    c, _ = free_biz
    points = {p["date"] for p in c.get("/monthly-summary").json()["history_points"]}
    assert OLD.isoformat() not in points


def test_forecast_history_shows_only_the_last_year(free_biz):
    c, _ = free_biz
    shown = {p["date"] for p in c.get("/forecast-history").json()["history"]}
    assert RECENT.isoformat() in shown
    assert OLD.isoformat() not in shown

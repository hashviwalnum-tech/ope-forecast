"""
Free-tier limits: do they actually bind?

Spec §10 is explicit — "Enforce caps server-side (never only client). Tier flag +
limit checks read live tier."

FINDING F-018: they read a *cached* tier.  Creating a business writes
`settings["tier"] = "premium"` for the 30-day trial, and the only thing that ever
writes it back down is the client calling `GET /subscription`.  A client that
never calls it — or an API-only caller — keeps every premium limit forever.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api.deps import get_current_user
from app.db import get_db
from app.engine.limits import FREE_ADS_LIMIT, FREE_EVENTS_LIMIT
from app.main import app
from app.models.subscription import TRIAL_DAYS

USER = "tier-limit-user"


@pytest.fixture()
def sim_clock(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    yield
    clock.unfreeze()


@pytest.fixture()
def tier_client(db):
    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _new_account(c) -> int:
    return c.post("/businesses", json={"name": "Test Cafe"}).json()["id"]


# ── the trial must actually end ──────────────────────────────────────────────

def test_trial_grants_premium_while_it_lasts(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    r = tier_client.post("/businesses", json={"name": "Second Location"})
    assert r.status_code == 201, "a trial user should be able to add a location"


def test_expired_trial_loses_premium_without_the_client_asking(tier_client, sim_clock):
    """The core of F-018.

    Nothing here calls GET /subscription — exactly like a user who never opens
    the premium screen, or any API-only client.  The limit must still bind.
    """
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)

    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
                 + timedelta(days=TRIAL_DAYS + 1))

    r = tier_client.post("/businesses", json={"name": "Second Location"})
    assert r.status_code == 403, (
        "an expired trial must not still be able to create extra locations — "
        "the tier check has to read the live subscription, not a cached flag"
    )
    assert "premium" in r.json()["detail"].lower()


def test_expired_trial_cannot_copy_a_location(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    biz_id = _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))
    r = tier_client.post(f"/businesses/{biz_id}/copy", json={"name": "Copy"})
    assert r.status_code == 403


def test_expired_trial_reverts_the_reported_tier(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))
    assert tier_client.get("/businesses/me").json()["tier"] == "free"


# ── ad and event allowances ──────────────────────────────────────────────────

def _make_period(c, i: int, kind: str):
    return c.post("/periods", json={
        "start_date": f"2026-03-{(i % 28) + 1:02d}",
        "end_date": f"2026-03-{(i % 28) + 1:02d}",
        "type": kind,
        "label": f"{kind} number {i}",
    })


def test_free_ad_allowance_binds(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))   # trial over

    for i in range(FREE_ADS_LIMIT):
        assert _make_period(tier_client, i, "ad").status_code == 201, f"ad {i}"
    r = _make_period(tier_client, FREE_ADS_LIMIT, "ad")
    assert r.status_code in (403, 422), "the free ad allowance must bind"
    assert "premium" in r.json()["detail"].lower()


def test_free_event_allowance_binds(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))

    for i in range(FREE_EVENTS_LIMIT):
        assert _make_period(tier_client, i, "event").status_code == 201, f"event {i}"
    r = _make_period(tier_client, FREE_EVENTS_LIMIT, "event")
    assert r.status_code in (403, 422)


def test_events_and_ads_have_separate_allowances(tier_client, sim_clock):
    """Filling the ad allowance must not stop the owner tagging an event."""
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))
    for i in range(FREE_ADS_LIMIT):
        _make_period(tier_client, i, "ad")
    assert _make_period(tier_client, 90, "event").status_code == 201


# ── history cap ──────────────────────────────────────────────────────────────

def test_free_history_cap_binds(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 3, 1, 20, 0, tzinfo=timezone.utc))    # trial over

    ok = tier_client.post("/day-records", json={"date": "2025-06-01", "customers": 40})
    assert ok.status_code == 201, "a date inside the 1-year window is fine"

    too_old = tier_client.post("/day-records", json={"date": "2024-06-01", "customers": 40})
    assert too_old.status_code == 403
    assert "premium" in too_old.json()["detail"].lower()


# ── upgrading must take effect immediately ───────────────────────────────────

def test_admin_upgrade_lifts_the_location_limit_at_runtime(tier_client, sim_clock, monkeypatch):
    monkeypatch.setenv("ADMIN_KEY", "test-admin-key")
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))

    assert tier_client.post("/businesses", json={"name": "Nope"}).status_code == 403

    up = tier_client.patch("/businesses/me/tier", json={"tier": "premium"},
                           headers={"X-Admin-Key": "test-admin-key"})
    assert up.status_code == 200
    assert tier_client.post("/businesses", json={"name": "Second"}).status_code == 201

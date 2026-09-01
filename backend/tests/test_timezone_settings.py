"""A business's time zone: set at sign-up, editable, and never guessed wrong.

The backend has always derived "today" from `business.settings["timezone"]`
(see `app/clock.py`). The web client derived it from the device — six places
via `new Date().toISOString()`, which is UTC — so the screen and the server
disagreed about which day a sale belonged to. Storing the zone at sign-up is
what lets both sides answer the same way; these tests cover the storing.

The client half is covered by web/src/lib/businessTime.test.ts.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db import get_db
from app.main import app

USER = "timezone-test-user"


@pytest.fixture()
def tz_client(db):
    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── set at sign-up ──────────────────────────────────────────────────────────

def test_a_new_business_keeps_the_zone_it_was_created_with(tz_client):
    r = tz_client.post("/businesses", json={"name": "Brooklyn Burger", "timezone": "America/New_York"})
    assert r.status_code == 201
    assert r.json()["settings"]["timezone"] == "America/New_York"


def test_creating_without_a_zone_still_works_and_stores_none(tz_client):
    # Older clients, and anything that posts only a name, must not break.
    r = tz_client.post("/businesses", json={"name": "No Zone Cafe"})
    assert r.status_code == 201
    assert "timezone" not in r.json()["settings"]


def test_a_made_up_zone_is_refused_rather_than_stored(tz_client):
    # A silently wrong zone files a day's sales under the wrong date — the exact
    # bug this field exists to close — so it is rejected, not defaulted.
    r = tz_client.post("/businesses", json={"name": "Nowhere", "timezone": "Middle/Earth"})
    assert r.status_code == 422


def test_an_empty_zone_is_treated_as_not_given(tz_client):
    r = tz_client.post("/businesses", json={"name": "Blank Zone", "timezone": "   "})
    assert r.status_code == 201
    assert "timezone" not in r.json()["settings"]


# ── changed later, in settings ──────────────────────────────────────────────

def test_the_zone_can_be_changed_in_settings(tz_client):
    tz_client.post("/businesses", json={"name": "Moving Shop", "timezone": "Europe/London"})
    r = tz_client.patch("/businesses/me/settings", json={"timezone": "Asia/Jerusalem"})
    assert r.status_code == 200
    assert r.json()["settings"]["timezone"] == "Asia/Jerusalem"


def test_settings_refuse_a_made_up_zone_too(tz_client):
    tz_client.post("/businesses", json={"name": "Typo Shop", "timezone": "Europe/London"})
    r = tz_client.patch("/businesses/me/settings", json={"timezone": "Europe/Londn"})
    assert r.status_code == 422
    # and the stored zone is untouched
    assert tz_client.get("/businesses/me").json()["settings"]["timezone"] == "Europe/London"


def test_changing_other_settings_leaves_the_zone_alone(tz_client):
    tz_client.post("/businesses", json={"name": "Steady Shop", "timezone": "Asia/Jerusalem"})
    tz_client.patch("/businesses/me/settings", json={"opening_hour": 8, "closing_hour": 20})
    settings = tz_client.get("/businesses/me").json()["settings"]
    assert settings["timezone"] == "Asia/Jerusalem"
    assert settings["opening_hour"] == 8


# ── the zone is what "today" is answered from ───────────────────────────────

def test_the_day_today_endpoints_report_comes_from_the_business_zone(tz_client):
    tz_client.post("/businesses", json={"name": "NY Shop", "timezone": "America/New_York"})
    body = tz_client.get("/sale-events/today").json()
    assert body["timezone"] == "America/New_York"

    tz_client.patch("/businesses/me/settings", json={"timezone": "Pacific/Auckland"})
    body = tz_client.get("/sale-events/today").json()
    assert body["timezone"] == "Pacific/Auckland"
    # Auckland is far enough ahead of New York that the two can be on different
    # dates at the same instant — which is the whole reason this setting exists.
    assert body["date"] is not None

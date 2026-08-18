"""A business's currency: chosen, stored, validated, and never assumed.

Money used to be written three different ways across Ope — the regulars screen
in US dollars, the planning toolbox with a hardcoded euro sign — with no
setting behind either. These tests cover the setting itself; the display side
is covered by web/src/lib/money.test.ts.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db import get_db
from app.main import app

USER = "currency-test-user"


@pytest.fixture()
def cur_client(db):
    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as c:
        c.post("/businesses", json={"name": "Test Cafe"})
        yield c
    app.dependency_overrides.clear()


# ── the picker's list ───────────────────────────────────────────────────────

def test_the_currency_list_is_served_for_the_pickers(client):
    r = client.get("/currencies")
    assert r.status_code == 200
    body = r.json()
    codes = {row["code"] for row in body["currencies"]}
    assert {"ILS", "USD", "EUR", "JPY", "KWD"} <= codes
    assert body["default"] in codes


def test_the_list_carries_precision_so_no_client_assumes_two_places(client):
    rows = {r["code"]: r for r in client.get("/currencies").json()["currencies"]}
    assert rows["JPY"]["minor_units"] == 0
    assert rows["USD"]["minor_units"] == 2
    assert rows["KWD"]["minor_units"] == 3


def test_the_list_needs_no_login_because_onboarding_reads_it_first(client):
    """It is the static ISO table — no user data, and needed before setup."""
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get("/currencies").status_code == 200


# ── choosing one ────────────────────────────────────────────────────────────

def test_a_business_starts_with_no_currency_rather_than_a_forced_one(cur_client):
    """Nothing is imposed: the client proposes, the owner confirms."""
    settings = cur_client.get("/businesses/me").json()["settings"]
    assert "currency" not in settings


def test_an_owner_can_set_their_currency(cur_client):
    r = cur_client.patch("/businesses/me/settings", json={"currency": "ILS"})
    assert r.status_code == 200
    assert r.json()["settings"]["currency"] == "ILS"


def test_a_currency_survives_being_read_back(cur_client):
    cur_client.patch("/businesses/me/settings", json={"currency": "JPY"})
    assert cur_client.get("/businesses/me").json()["settings"]["currency"] == "JPY"


def test_a_currency_can_be_changed_later(cur_client):
    cur_client.patch("/businesses/me/settings", json={"currency": "EUR"})
    cur_client.patch("/businesses/me/settings", json={"currency": "GBP"})
    assert cur_client.get("/businesses/me").json()["settings"]["currency"] == "GBP"


def test_a_lower_case_code_is_stored_in_the_canonical_form(cur_client):
    r = cur_client.patch("/businesses/me/settings", json={"currency": "ils"})
    assert r.json()["settings"]["currency"] == "ILS"


def test_setting_currency_leaves_the_other_settings_alone(cur_client):
    cur_client.patch("/businesses/me/settings",
                     json={"opening_days": [0, 1, 2], "opening_hour": 8})
    cur_client.patch("/businesses/me/settings", json={"currency": "JPY"})
    s = cur_client.get("/businesses/me").json()["settings"]
    assert s["currency"] == "JPY"
    assert s["opening_days"] == [0, 1, 2]
    assert s["opening_hour"] == 8


# ── rejecting nonsense ──────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["ZZZ", "US", "DOLLARS", "", "123", "XAU"])
def test_an_unknown_currency_is_refused_not_silently_defaulted(cur_client, bad):
    """A business saving "SHEKEL" and then being shown dollars without a word
    is the kind of quiet wrongness that discredits every other figure shown."""
    r = cur_client.patch("/businesses/me/settings", json={"currency": bad})
    assert r.status_code == 422, f"{bad!r} should have been rejected"


def test_a_refused_currency_does_not_overwrite_the_stored_one(cur_client):
    cur_client.patch("/businesses/me/settings", json={"currency": "ILS"})
    cur_client.patch("/businesses/me/settings", json={"currency": "NOPE"})
    assert cur_client.get("/businesses/me").json()["settings"]["currency"] == "ILS"


# ── new locations ───────────────────────────────────────────────────────────

def test_a_copied_location_keeps_the_currency(cur_client):
    """Copying a location copies settings (spec §10) — currency is one."""
    cur_client.patch("/businesses/me/settings", json={"currency": "JPY"})
    src = cur_client.get("/businesses/me").json()["id"]
    r = cur_client.post(f"/businesses/{src}/copy", json={"name": "Second Shop"})
    if r.status_code == 403:
        pytest.skip("copy needs premium; covered by the tier tests")
    assert r.status_code == 201
    assert r.json()["settings"]["currency"] == "JPY"

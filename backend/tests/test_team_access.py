"""Team access, slice 1: staff log sales on their own phones — and nothing else.

The rule this file exists to hold: every route is OWNER-ONLY unless it asks for
`get_business_staff_ok` by name. `test_only_the_approved_routes_let_staff_in`
reads every route the app has, so a new route that opens itself to staff — on
purpose or by accident — fails the build until this list is changed knowingly.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app import clock
from app.api import account as account_api
from app.api.deps import get_business_staff_ok, get_current_email, get_current_user
from app.db import get_db
from app.main import app
from app.models import Business, Product, SaleEvent
from app.models.team import TeamMember

OWNER = "team-owner"
STAFF = "team-staff"
STRANGER = "team-stranger"
T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)

# The whole of what staff may do in slice 1. Change only on purpose.
STAFF_ROUTES = {
    ("POST", "/sale-events"),
    ("GET", "/sale-events/today"),
    ("DELETE", "/sale-events/{event_id}"),
    ("GET", "/products"),
}


def _depends_on(dependant, fn) -> bool:
    return any(d.call is fn or _depends_on(d, fn) for d in dependant.dependencies)


def _all_routes(routes):
    """Every APIRoute, including those inside included routers — newer FastAPI
    wraps each include_router() in an object that is not itself a route."""
    for r in routes:
        if isinstance(r, APIRoute):
            yield r
        inner = getattr(r, "original_router", None) or getattr(r, "router", None)
        if inner is not None and hasattr(inner, "routes"):
            yield from _all_routes(inner.routes)


def test_only_the_approved_routes_let_staff_in():
    routes = list(_all_routes(app.routes))
    assert len(routes) > 60, f"found only {len(routes)} routes: the walk is broken, not the app"
    open_to_staff = {
        (m, r.path)
        for r in routes if _depends_on(r.dependant, get_business_staff_ok)
        for m in r.methods
    }
    assert open_to_staff == STAFF_ROUTES


# ── a café with an owner, a barista, and someone with nothing to do with it ──

@pytest.fixture()
def sim_clock(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    clock.freeze(T0)
    yield
    clock.unfreeze()


@pytest.fixture()
def cafe(db, sim_clock, monkeypatch):
    who = {"user": OWNER}

    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: who["user"]
    app.dependency_overrides[get_current_email] = lambda: f"{who['user']}@example.com"
    monkeypatch.setattr(account_api, "_delete_auth_user", lambda uid: (True, None))

    with TestClient(app) as c:
        def as_(user):
            who["user"] = user
            return c
        biz_id = as_(OWNER).post("/businesses", json={"name": "Corner Cafe"}).json()["id"]  # trial = Premium
        db.add(Product(business_id=biz_id, name="Latte", unit="cups", price=14.0, lead_time_days=1))
        db.commit()
        code = as_(OWNER).post("/team/invite").json()["code"]
        joined = as_(STAFF).post("/team/join", json={"code": code})
        assert joined.status_code == 200, joined.text
        yield as_, db, biz_id
    app.dependency_overrides.clear()


def _h(biz_id: int) -> dict:
    return {"X-Business-Id": str(biz_id)}


def test_staff_see_the_business_as_staff_with_only_the_clock_settings(cafe, db):
    as_, _, biz_id = cafe
    db.get(Business, biz_id).settings = {"timezone": "Asia/Jerusalem", "opening_hour": 7,
                                         "currency": "ILS", "staffing_max_wait_minutes": 5}
    db.commit()
    rows = as_(STAFF).get("/businesses").json()
    assert len(rows) == 1 and rows[0]["id"] == biz_id and rows[0]["role"] == "staff"
    assert rows[0]["settings"] == {"timezone": "Asia/Jerusalem", "opening_hour": 7}
    assert as_(OWNER).get("/businesses").json()[0]["role"] == "owner"


def test_staff_can_tap_see_today_and_the_buttons_but_never_a_price(cafe, db):
    as_, _, biz_id = cafe
    staff = as_(STAFF)
    assert staff.post("/sale-events", json={}, headers=_h(biz_id)).status_code == 201
    assert staff.post("/sale-events", json={}).status_code == 201       # no header: their one team
    assert staff.get("/sale-events/today", headers=_h(biz_id)).json()["total_taps"] == 2
    products = staff.get("/products", headers=_h(biz_id)).json()
    assert products[0]["name"] == "Latte" and products[0]["price"] is None
    assert as_(OWNER).get("/products").json()[0]["price"] == 14.0
    assert db.query(SaleEvent).filter_by(business_id=biz_id).count() == 2


@pytest.mark.parametrize("method,path", [
    ("GET", "/day-records"), ("GET", "/regulars"), ("GET", "/forecast"),
    ("GET", "/ordering"), ("GET", "/export/days.csv"), ("GET", "/export/all.json"),
    ("GET", "/team"), ("POST", "/team/invite"), ("POST", "/products"),
    ("GET", "/periods"), ("GET", "/orders"),
])
def test_everything_else_is_refused_to_staff(cafe, method, path):
    as_, _, biz_id = cafe
    staff = as_(STAFF)
    with_header = staff.request(method, path, headers=_h(biz_id), json={})
    without = staff.request(method, path, json={})
    assert with_header.status_code == 404, (path, with_header.text)
    assert without.status_code in (404, 422), (path, without.text)


def test_staff_cannot_change_the_business_settings(cafe, db):
    as_, _, biz_id = cafe
    r = as_(STAFF).patch("/businesses/me/settings", json={"opening_hour": 3})
    assert r.status_code == 404
    assert db.get(Business, biz_id).settings.get("opening_hour") != 3


def test_staff_undo_only_a_recent_tap(cafe, db):
    as_, _, biz_id = cafe
    staff = as_(STAFF)
    recent = staff.post("/sale-events", json={}, headers=_h(biz_id)).json()["id"]
    assert staff.delete(f"/sale-events/{recent}", headers=_h(biz_id)).status_code == 204
    old = SaleEvent(business_id=biz_id, product_id=None, quantity=1,
                    timestamp=(T0 - timedelta(hours=3)).replace(tzinfo=None))
    db.add(old)
    db.commit()
    r = staff.delete(f"/sale-events/{old.id}", headers=_h(biz_id))
    assert r.status_code == 403 and r.json()["code"] == "staff_undo_too_old"
    assert as_(OWNER).delete(f"/sale-events/{old.id}").status_code == 204


def test_a_removed_member_is_locked_out_on_their_next_tap(cafe, db):
    as_, _, biz_id = cafe
    team = as_(OWNER).get("/team").json()
    assert [m["email"] for m in team["members"]] == [f"{STAFF}@example.com"]
    assert as_(OWNER).delete(f"/team/members/{team['members'][0]['id']}").status_code == 204
    r = as_(STAFF).post("/sale-events", json={}, headers=_h(biz_id))
    assert r.status_code == 404 and r.json()["code"] == "business_not_found"
    assert as_(STAFF).get("/businesses").json() == []


def test_staff_leaving_keeps_the_business(cafe, db):
    as_, _, biz_id = cafe
    assert as_(STAFF).delete(f"/team/membership/{biz_id}").status_code == 204
    assert db.get(Business, biz_id) is not None
    assert db.query(TeamMember).count() == 0


def test_when_the_owners_premium_ends_so_does_team_access(cafe):
    as_, _, biz_id = cafe
    clock.freeze(T0 + timedelta(days=45))                     # trial over, no purchase
    r = as_(STAFF).post("/sale-events", json={}, headers=_h(biz_id))
    assert r.status_code == 403 and r.json()["code"] == "team_access_ended"
    assert as_(STAFF).get("/businesses").json() == []
    r = as_(OWNER).post("/team/invite")
    assert r.status_code == 403 and r.json()["code"] == "team_needs_premium"
    assert as_(OWNER).get("/team").json()["available"] is False


def test_a_stranger_cannot_use_someone_elses_team(cafe, db):
    as_, _, biz_id = cafe
    r = as_(STRANGER).post("/sale-events", json={}, headers=_h(biz_id))
    assert r.status_code == 404
    assert db.query(SaleEvent).filter_by(business_id=biz_id).count() == 0


def test_codes_bad_expired_own_and_typed_loosely(cafe):
    as_, _, _ = cafe
    assert as_(STRANGER).post("/team/join", json={"code": "ZZZZ-ZZZZ"}).json()["code"] == "team_code_invalid"
    code = as_(OWNER).post("/team/invite").json()["code"]
    assert as_(OWNER).post("/team/join", json={"code": code}).json()["code"] == "team_own_business"
    loose = " " + code.lower().replace("-", " ") + " "
    assert as_(STRANGER).post("/team/join", json={"code": loose}).status_code == 200
    clock.freeze(T0 + timedelta(hours=25))
    late = as_("late-barista").post("/team/join", json={"code": code})
    assert late.status_code == 404 and late.json()["code"] == "team_code_invalid"


def test_a_new_code_replaces_the_old_one(cafe):
    as_, _, _ = cafe
    old = as_(OWNER).post("/team/invite").json()["code"]
    as_(OWNER).post("/team/invite")
    assert as_(STRANGER).post("/team/join", json={"code": old}).status_code == 404


def test_deleting_a_staff_account_removes_only_the_membership(cafe, db):
    as_, _, biz_id = cafe
    assert as_(STAFF).delete("/account").status_code == 200
    assert db.query(TeamMember).count() == 0
    assert db.get(Business, biz_id) is not None


def test_deleting_the_business_removes_its_team(cafe, db):
    as_, _, biz_id = cafe
    as_(OWNER).delete("/account")
    assert db.query(TeamMember).count() == 0

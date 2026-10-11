"""X-Business-Id names one business; a business that is not the caller's is
refused, never swapped for another.

It used to fall back silently to the caller's first business. A tap queued on
the phone for a business deleted since — or a stale browser tab — then wrote
into a different business from the one the owner was looking at.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models import Business, SaleEvent

OWNER = "header-owner"
OTHER = "header-other"


@pytest.fixture()
def setup(db):
    mine_a = Business(name="Cafe A", user_id=OWNER, settings={})
    mine_b = Business(name="Cafe B", user_id=OWNER, settings={})
    theirs = Business(name="Not yours", user_id=OTHER, settings={})
    db.add_all([mine_a, mine_b, theirs])
    db.commit()

    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: OWNER
    with TestClient(app) as c:
        yield c, db, mine_a, mine_b, theirs
    app.dependency_overrides.clear()


def _taps(db, biz):
    return db.query(SaleEvent).filter_by(business_id=biz.id).count()


def test_the_named_business_is_the_one_used(setup):
    c, db, a, b, _ = setup
    assert c.post("/sale-events", json={}, headers={"X-Business-Id": str(b.id)}).status_code == 201
    assert (_taps(db, a), _taps(db, b)) == (0, 1)


def test_a_business_that_no_longer_exists_is_refused_not_swapped(setup):
    c, db, a, b, _ = setup
    gone = b.id
    db.delete(b)
    db.commit()
    r = c.post("/sale-events", json={}, headers={"X-Business-Id": str(gone)})
    assert r.status_code == 404
    assert r.json()["code"] == "business_not_found"
    assert _taps(db, a) == 0, "the tap went into a different business"


def test_someone_elses_business_is_refused_and_untouched(setup):
    c, db, a, _, theirs = setup
    r = c.post("/sale-events", json={}, headers={"X-Business-Id": str(theirs.id)})
    assert r.status_code == 404
    assert _taps(db, theirs) == 0 and _taps(db, a) == 0


def test_a_garbled_header_is_refused(setup):
    c, db, a, _, _ = setup
    assert c.post("/sale-events", json={}, headers={"X-Business-Id": "abc"}).status_code == 400
    assert _taps(db, a) == 0


def test_with_no_header_the_first_business_is_used(setup):
    c, db, a, _, _ = setup
    assert c.post("/sale-events", json={}).status_code == 201
    assert _taps(db, a) == 1

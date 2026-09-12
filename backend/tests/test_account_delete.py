"""Deleting an account removes everything, and is honest when it cannot.

Google Play rejects an app that lets people make an account and not unmake one,
so this endpoint is the difference between a submittable Android build and a
rejected one. Two things have to hold, and they are separate failures:

* **Nothing of the account survives** — not one of its locations, not a child
  row under any of them, and not the subscription, which hangs off ``user_id``
  rather than a business and so is missed by the per-business cascade.
* **Another account is untouched.** A deletion that reached across tenants would
  be the worst bug in the system, and it is one line of filter away.

The Supabase call is stubbed throughout: these tests must not reach the network,
and the one case that matters most is the one where that call *fails* — the data
must still be gone, and the response must say the sign-in was not removed rather
than reporting success.
"""
from __future__ import annotations

from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from app.api import account as account_api
from app.api.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models import Business, DayRecord, Product, SaleRecord
from app.models.subscription import Subscription

USER_A = "user-aaaa-0000"
USER_B = "user-bbbb-1111"


@pytest.fixture()
def acct(db, monkeypatch):
    """A client signed in as USER_A, with the Supabase admin call stubbed out."""
    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER_A
    monkeypatch.setattr(account_api, "_delete_auth_user", lambda uid: (True, None))
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _stock_a_business(db, user_id: str, name: str) -> Business:
    """A business with a location's worth of real rows under it."""
    biz = Business(name=name, user_id=user_id, settings={})
    db.add(biz)
    db.commit()

    product = Product(business_id=biz.id, name=f"{name} beans", unit="kg")
    day = DayRecord(business_id=biz.id, date=date(2026, 3, 1), customers=40)
    db.add_all([product, day])
    db.commit()

    db.add(SaleRecord(day_record_id=day.id, product_id=product.id, units_sold=12))
    db.commit()
    return biz


def test_delete_account_removes_every_business_and_its_rows(acct, db):
    a1 = _stock_a_business(db, USER_A, "First")
    a2 = _stock_a_business(db, USER_A, "Second")

    r = acct.delete("/account")
    assert r.status_code == 200, r.text
    assert r.json()["businesses_deleted"] == 2
    assert r.json()["login_deleted"] is True

    assert db.query(Business).filter(Business.id.in_([a1.id, a2.id])).count() == 0
    for biz_id in (a1.id, a2.id):
        assert db.query(Product).filter_by(business_id=biz_id).count() == 0
        assert db.query(DayRecord).filter_by(business_id=biz_id).count() == 0
    # SaleRecord reaches the business only through its day — the indirect leg of
    # the cascade, and the one a hand-written table list would forget.
    assert db.query(SaleRecord).count() == 0


def test_delete_account_removes_the_subscription(acct, db):
    """The subscription is keyed on user_id, so the per-business sweep misses it.

    Leaving it behind would be worse than untidy: a new account created with the
    same Supabase id would inherit the old tier.
    """
    _stock_a_business(db, USER_A, "Only")
    db.add(Subscription(user_id=USER_A, tier="premium"))
    db.commit()

    assert acct.delete("/account").status_code == 200
    assert db.query(Subscription).filter_by(user_id=USER_A).count() == 0


def test_delete_account_does_not_touch_another_account(acct, db):
    mine = _stock_a_business(db, USER_A, "Mine")
    theirs = _stock_a_business(db, USER_B, "Theirs")
    db.add(Subscription(user_id=USER_B, tier="premium"))
    db.commit()

    assert acct.delete("/account").json()["businesses_deleted"] == 1

    assert db.query(Business).filter_by(id=mine.id).count() == 0
    assert db.query(Business).filter_by(id=theirs.id).count() == 1
    assert db.query(Product).filter_by(business_id=theirs.id).count() == 1
    assert db.query(DayRecord).filter_by(business_id=theirs.id).count() == 1
    assert db.query(SaleRecord).count() == 1
    assert db.query(Subscription).filter_by(user_id=USER_B).count() == 1


def test_the_data_still_goes_when_the_sign_in_cannot_be_removed(db, monkeypatch):
    """The service-role key is missing, or Supabase refuses.

    The data must still be deleted — a deletion request half-honoured is better
    than not honoured — and the response must say the sign-in survived instead of
    reporting a clean success the owner would believe.
    """
    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER_A
    monkeypatch.setattr(
        account_api, "_delete_auth_user",
        lambda uid: (False, "SUPABASE_SERVICE_ROLE_KEY is not configured, so the "
                            "sign-in itself could not be removed."),
    )
    try:
        biz = _stock_a_business(db, USER_A, "Doomed")
        r = TestClient(app).delete("/account")
        assert r.status_code == 200
        body = r.json()
        assert body["login_deleted"] is False
        assert body["detail"] and "SUPABASE_SERVICE_ROLE_KEY" in body["detail"]
        assert db.query(Business).filter_by(id=biz.id).count() == 0
        assert db.query(Product).filter_by(business_id=biz.id).count() == 0
    finally:
        app.dependency_overrides.clear()


def test_deleting_an_account_with_nothing_in_it_is_not_an_error(acct, db):
    """Someone who signed up and never finished onboarding can still leave."""
    r = acct.delete("/account")
    assert r.status_code == 200
    assert r.json()["businesses_deleted"] == 0


def test_the_endpoint_requires_a_token(db):
    """No override this time — the real dependency must refuse an anonymous call."""
    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    try:
        assert TestClient(app).delete("/account").status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_missing_service_role_key_is_reported_rather_than_assumed(monkeypatch):
    """The real `_delete_auth_user` must not attempt the call without the key.

    Checked directly rather than through the endpoint, because the point is that
    no network request is made at all.
    """
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)

    def _explode(*a, **k):                      # pragma: no cover - must not run
        raise AssertionError("attempted a Supabase call with no service-role key")

    monkeypatch.setattr(account_api.urllib.request, "urlopen", _explode)

    deleted, why_not = account_api._delete_auth_user(USER_A)
    assert deleted is False
    assert "SUPABASE_SERVICE_ROLE_KEY" in why_not

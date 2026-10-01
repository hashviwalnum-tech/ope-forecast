"""The Google Play endpoints, end to end against a fake Google.

Everything Ope does with a purchase, short of Google itself: verifying a token,
refusing a token that belongs to someone else, notifications for renewals,
cancellations, grace, hold and refunds, the manual grant, and cancelling Play
before an account is deleted.  ``FakePlay`` stands in for Google; what it
returns is the documented ``subscriptionsv2`` shape.
"""
import base64
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api import billing as billing_api
from app.api.deps import get_current_user, resolve_tier
from app.billing.google_play import PlayError, get_play_client
from app.billing.play_state import play_account_id
from app.db import get_db
from app.main import app
from app.models import Business
from app.models.subscription import Subscription

USER = "play-user-1"
OTHER = "play-user-2"
ADMIN = "test-admin-key-play"
T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f") + "123Z"


class FakePlay:
    def __init__(self):
        self.purchases: dict[str, dict] = {}
        self.acked: list[str] = []
        self.cancelled: list[str] = []
        self.fail_get = False
        self.fail_cancel = False

    def set(self, token, state="SUBSCRIPTION_STATE_ACTIVE", *, user=USER, days=30,
            ack="ACKNOWLEDGEMENT_STATE_PENDING", linked=None, product="ope_premium"):
        body = {
            "subscriptionState": state,
            "acknowledgementState": ack,
            "externalAccountIdentifiers": {"obfuscatedExternalAccountId": play_account_id(user)},
            "lineItems": [{"productId": product, "expiryTime": _iso(clock.now_utc() + timedelta(days=days)),
                           "autoRenewingPlan": {"autoRenewEnabled": state == "SUBSCRIPTION_STATE_ACTIVE"}}],
        }
        if linked:
            body["linkedPurchaseToken"] = linked
        self.purchases[token] = body

    def get(self, token):
        if self.fail_get:
            raise PlayError("down")
        if token not in self.purchases:
            raise PlayError("404", not_found=True)
        return self.purchases[token]

    def acknowledge(self, product_id, token):
        self.acked.append(token)
        self.purchases[token]["acknowledgementState"] = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"

    def cancel(self, product_id, token):
        if self.fail_cancel:
            raise PlayError("down")
        self.cancelled.append(token)
        self.purchases[token]["subscriptionState"] = "SUBSCRIPTION_STATE_CANCELED"


@pytest.fixture()
def frozen(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("ADMIN_KEY", ADMIN)
    clock.freeze(T0)
    yield
    clock.unfreeze()


@pytest.fixture()
def play():
    return FakePlay()


@pytest.fixture()
def as_user(db, play, frozen):
    who = {"id": USER}

    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: who["id"]
    app.dependency_overrides[get_play_client] = lambda: play
    app.dependency_overrides[billing_api.verify_pubsub_push] = lambda: None
    with TestClient(app) as c:
        c.who = who
        yield c
    app.dependency_overrides.clear()


def _trial_over(db, user=USER):
    db.add(Subscription(user_id=user, tier="trial", trial_started_at=T0 - timedelta(days=60),
                        trial_ends_at=T0 - timedelta(days=30), subscription_status="none"))
    db.commit()


def _rtdn(c, token, kind=4):
    data = {"version": "1.0", "packageName": "com.opeforecast.app", "eventTimeMillis": "1",
            "subscriptionNotification": {"version": "1.0", "notificationType": kind,
                                         "purchaseToken": token, "subscriptionId": "ope_premium"}}
    msg = base64.b64encode(json.dumps(data).encode()).decode()
    return c.post("/billing/google/rtdn", json={"message": {"data": msg}, "subscription": "x"})


def _verify(c, token, product="ope_premium"):
    return c.post("/billing/google/verify", json={"purchase_token": token, "product_id": product})


# ── verify ───────────────────────────────────────────────────────────────────

def test_verified_purchase_grants_premium_and_is_acknowledged(as_user, db, play):
    _trial_over(db)
    assert not resolve_tier(db, USER).is_premium
    play.set("tok-1")
    r = _verify(as_user, "tok-1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["effective_tier"] == "premium"
    assert body["subscription_provider"] == "google_play"
    assert body["subscription_status"] == "active"
    assert play.acked == ["tok-1"]
    assert resolve_tier(db, USER).is_premium


def test_subscription_exposes_the_account_id_the_phone_must_send(as_user):
    assert as_user.get("/subscription").json()["play_account_id"] == play_account_id(USER)


def test_a_token_bought_for_another_account_is_refused(as_user, db, play):
    play.set("tok-x", user=OTHER)
    r = _verify(as_user, "tok-x")
    assert r.status_code == 403
    assert r.json()["detail"] == "purchase_belongs_to_another_account"
    assert not db.query(Subscription).filter_by(subscription_provider_id="tok-x").first()


def test_a_token_already_on_another_account_is_refused(as_user, db, play):
    play.set("tok-1")
    assert _verify(as_user, "tok-1").status_code == 200
    as_user.who["id"] = OTHER
    assert _verify(as_user, "tok-1").status_code == 409


def test_unknown_product_and_unknown_token_are_refused(as_user, play):
    play.set("tok-1", product="something_else")
    assert _verify(as_user, "tok-1", product="something_else").status_code == 400
    assert _verify(as_user, "nope").status_code == 400


def test_google_unreachable_is_a_502_not_a_grant(as_user, db, play):
    _trial_over(db)
    play.set("tok-1")
    play.fail_get = True
    assert _verify(as_user, "tok-1").status_code == 502
    assert not resolve_tier(db, USER).is_premium


def test_without_credentials_the_server_says_so(db, frozen):
    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_play_client] = lambda: None
    try:
        with TestClient(app) as c:
            r = _verify(c, "tok-1")
        assert r.status_code == 503 and r.json()["detail"] == "play_not_configured"
    finally:
        app.dependency_overrides.clear()


# ── notifications: the lifecycle ─────────────────────────────────────────────

def test_rtdn_endpoint_refuses_everything_when_not_configured(db, frozen, monkeypatch):
    monkeypatch.delenv("GOOGLE_RTDN_AUDIENCE", raising=False)
    with TestClient(app) as c:
        assert _rtdn(c, "tok-1").status_code == 503


def test_rtdn_without_a_token_is_refused_when_configured(db, frozen, monkeypatch):
    monkeypatch.setenv("GOOGLE_RTDN_AUDIENCE", "https://example/rtdn")
    monkeypatch.setenv("GOOGLE_RTDN_SERVICE_ACCOUNT", "push@example.iam.gserviceaccount.com")
    with TestClient(app) as c:
        assert _rtdn(c, "tok-1").status_code == 401


def test_cancellation_keeps_premium_until_paid_through_then_ends(as_user, db, play):
    _trial_over(db)
    play.set("tok-1", days=10)
    _verify(as_user, "tok-1")
    play.set("tok-1", "SUBSCRIPTION_STATE_CANCELED", days=10)
    assert _rtdn(as_user, "tok-1", kind=3).status_code == 200
    sub = db.query(Subscription).filter_by(user_id=USER).first()
    db.refresh(sub)
    assert sub.subscription_status == "cancelled"
    assert resolve_tier(db, USER).is_premium, "paid for ten more days"
    clock.freeze(T0 + timedelta(days=10, seconds=1))
    assert not resolve_tier(db, USER).is_premium


def test_renewal_moves_paid_through_forward(as_user, db, play):
    _trial_over(db)
    play.set("tok-1", days=30)
    _verify(as_user, "tok-1")
    clock.freeze(T0 + timedelta(days=29))
    play.set("tok-1", days=31, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
    _rtdn(as_user, "tok-1", kind=2)
    clock.freeze(T0 + timedelta(days=45))
    assert resolve_tier(db, USER).is_premium


def test_failed_payment_grace_then_hold(as_user, db, play):
    _trial_over(db)
    play.set("tok-1", days=1)
    _verify(as_user, "tok-1")
    clock.freeze(T0 + timedelta(days=3))
    play.set("tok-1", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", days=-2)
    _rtdn(as_user, "tok-1", kind=6)
    assert resolve_tier(db, USER).is_premium, "Google requires access during grace"
    play.set("tok-1", "SUBSCRIPTION_STATE_ON_HOLD", days=-2)
    _rtdn(as_user, "tok-1", kind=5)
    assert not resolve_tier(db, USER).is_premium


def test_refund_with_revocation_ends_premium_at_once(as_user, db, play):
    _trial_over(db)
    play.set("tok-1", days=20)
    _verify(as_user, "tok-1")
    play.set("tok-1", "SUBSCRIPTION_STATE_EXPIRED", days=20)
    _rtdn(as_user, "tok-1", kind=12)          # SUBSCRIPTION_REVOKED
    assert not resolve_tier(db, USER).is_premium


def test_notification_is_only_a_hint_google_is_asked(as_user, db, play):
    """A notification that claims a cancellation while Google says active
    changes nothing — the notification's own type is never trusted."""
    _trial_over(db)
    play.set("tok-1", days=20)
    _verify(as_user, "tok-1")
    _rtdn(as_user, "tok-1", kind=3)           # says "cancelled"
    sub = db.query(Subscription).filter_by(user_id=USER).first()
    db.refresh(sub)
    assert sub.subscription_status == "active"


def test_a_purchase_the_phone_never_reported_is_found_and_acknowledged(as_user, db, play):
    """The phone died between paying and calling /verify. The notification
    finds the account by its hashed id, and the purchase is acknowledged so
    Google does not refund it."""
    _trial_over(db)
    play.set("tok-new")
    assert _rtdn(as_user, "tok-new", kind=4).status_code == 200
    assert resolve_tier(db, USER).is_premium
    assert "tok-new" in play.acked


def test_a_replacement_token_follows_the_old_one(as_user, db, play):
    _trial_over(db)
    play.set("tok-old")
    _verify(as_user, "tok-old")
    play.set("tok-new", linked="tok-old")
    _rtdn(as_user, "tok-new", kind=4)
    sub = db.query(Subscription).filter_by(user_id=USER).first()
    db.refresh(sub)
    assert sub.subscription_provider_id == "tok-new"


def test_google_down_during_a_notification_asks_pubsub_to_retry(as_user, db, play):
    play.set("tok-1")
    _verify(as_user, "tok-1")
    play.fail_get = True
    assert _rtdn(as_user, "tok-1").status_code == 500


def test_a_test_notification_is_accepted(as_user):
    data = {"version": "1.0", "packageName": "com.opeforecast.app", "testNotification": {"version": "1.0"}}
    msg = base64.b64encode(json.dumps(data).encode()).decode()
    r = as_user.post("/billing/google/rtdn", json={"message": {"data": msg}})
    assert r.status_code == 200 and r.json().get("test") is True


def test_opening_the_account_asks_google_when_the_paid_period_has_run_out(as_user, db, play):
    """Belt and braces behind missed notifications."""
    _trial_over(db)
    play.set("tok-1", days=5)
    _verify(as_user, "tok-1")
    clock.freeze(T0 + timedelta(days=7))
    play.set("tok-1", days=28, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")   # renewed, unheard
    assert as_user.get("/subscription").json()["effective_tier"] == "premium"


# ── manual grants ────────────────────────────────────────────────────────────

def test_grant_with_end_date_then_it_ends(as_user, db):
    _trial_over(db)
    ends = (T0 + timedelta(days=14)).isoformat()
    r = as_user.post("/admin/grants", json={"user_id": USER, "ends_at": ends},
                     headers={"X-Admin-Key": ADMIN})
    assert r.status_code == 200, r.text
    assert resolve_tier(db, USER).is_premium
    clock.freeze(T0 + timedelta(days=15))
    assert not resolve_tier(db, USER).is_premium


def test_grants_need_the_admin_key(as_user):
    assert as_user.post("/admin/grants", json={"user_id": USER}).status_code == 403
    assert as_user.delete(f"/admin/grants/{USER}").status_code == 403


def test_revoking_a_grant_never_downgrades_a_paying_owner(as_user, db, play):
    _trial_over(db)
    play.set("tok-1")
    _verify(as_user, "tok-1")
    as_user.post("/admin/grants", json={"user_id": USER}, headers={"X-Admin-Key": ADMIN})
    r = as_user.delete(f"/admin/grants/{USER}", headers={"X-Admin-Key": ADMIN})
    assert r.status_code == 200
    assert resolve_tier(db, USER).is_premium


def test_the_old_tier_shortcut_cannot_force_a_paying_owner_to_free(as_user, db, play):
    db.add(Business(name="Cafe", user_id=USER, settings={}))
    db.commit()
    _trial_over(db)
    play.set("tok-1")
    _verify(as_user, "tok-1")
    r = as_user.patch("/businesses/me/tier", json={"tier": "free"}, headers={"X-Admin-Key": ADMIN})
    assert r.status_code == 200
    assert r.json()["tier"] == "premium"


def test_old_settings_overrides_become_grants(db, frozen):
    from app.billing.grants import migrate_admin_overrides
    db.add(Business(name="Pilot", user_id=USER, settings={"tier": "premium", "tier_admin_override": True, "x": 1}))
    db.add(Business(name="Forced", user_id=OTHER, settings={"tier": "free", "tier_admin_override": True}))
    db.commit()
    assert migrate_admin_overrides(db) == 1
    sub = db.query(Subscription).filter_by(user_id=USER).first()
    assert sub.manual_grant is True and sub.manual_grant_ends_at is None
    for b in db.query(Business).all():
        assert "tier_admin_override" not in b.settings and "tier" not in b.settings
    assert db.query(Business).filter_by(name="Pilot").first().settings == {"x": 1}
    assert migrate_admin_overrides(db) == 0, "idempotent"


# ── deleting an account while subscribed ─────────────────────────────────────

def test_deleting_an_account_cancels_its_play_subscription_first(as_user, db, play, monkeypatch):
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    db.add(Business(name="Cafe", user_id=USER, settings={}))
    db.commit()
    play.set("tok-1")
    _verify(as_user, "tok-1")
    r = as_user.delete("/account")
    assert r.status_code == 200, r.text
    assert play.cancelled == ["tok-1"]
    assert db.query(Business).filter_by(user_id=USER).count() == 0


def test_if_play_cannot_be_cancelled_nothing_is_deleted(as_user, db, play):
    db.add(Business(name="Cafe", user_id=USER, settings={}))
    db.commit()
    play.set("tok-1")
    _verify(as_user, "tok-1")
    play.fail_cancel = True
    r = as_user.delete("/account")
    assert r.status_code == 409
    assert r.json()["detail"] == "play_subscription_active"
    assert db.query(Business).filter_by(user_id=USER).count() == 1
    assert db.query(Subscription).filter_by(user_id=USER).count() == 1


def test_without_credentials_a_renewing_subscription_blocks_deletion(db, frozen, play):
    db.add(Business(name="Cafe", user_id=USER, settings={}))
    db.add(Subscription(user_id=USER, tier="premium", subscription_status="active",
                        subscription_provider="google_play", subscription_provider_id="tok-1",
                        play_product_id="ope_premium", renewal_at=T0 + timedelta(days=5)))
    db.commit()

    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_play_client] = lambda: None
    try:
        with TestClient(app) as c:
            assert c.delete("/account").status_code == 409
    finally:
        app.dependency_overrides.clear()
    assert db.query(Business).filter_by(user_id=USER).count() == 1


def test_an_already_cancelled_subscription_does_not_block_deletion(as_user, db, play, monkeypatch):
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    play.set("tok-1")
    _verify(as_user, "tok-1")
    play.set("tok-1", "SUBSCRIPTION_STATE_CANCELED")
    _rtdn(as_user, "tok-1", kind=3)
    play.fail_cancel = True                       # would 409 if it were attempted
    assert as_user.delete("/account").status_code == 200

"""Known-answer tests for the two pure billing functions.

``play_state_from_purchase`` — Google's JSON in, our facts out.
``is_premium``               — the one rule deciding premium.

No database, no network, no Google credentials: these run anywhere.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.billing.entitlement import RENEWAL_LEEWAY, is_premium
from app.billing.play_state import parse_rfc3339, play_account_id, play_state_from_purchase

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
USER = "8a6c1c2e-0000-4000-8000-000000000001"


def _purchase(state="SUBSCRIPTION_STATE_ACTIVE", expiry="2026-11-01T12:00:00.123456789Z", **extra):
    body = {
        "kind": "androidpublisher#subscriptionPurchaseV2",
        "subscriptionState": state,
        "acknowledgementState": "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
        "externalAccountIdentifiers": {"obfuscatedExternalAccountId": play_account_id(USER)},
        "lineItems": [{
            "productId": "ope_premium",
            "expiryTime": expiry,
            "autoRenewingPlan": {"autoRenewEnabled": True},
        }],
    }
    body.update(extra)
    return body


# ── Google state → ours ──────────────────────────────────────────────────────

@pytest.mark.parametrize("google, ours", [
    ("SUBSCRIPTION_STATE_ACTIVE", "active"),
    ("SUBSCRIPTION_STATE_CANCELED", "cancelled"),
    ("SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "grace"),
    ("SUBSCRIPTION_STATE_ON_HOLD", "on_hold"),
    ("SUBSCRIPTION_STATE_PAUSED", "paused"),
    ("SUBSCRIPTION_STATE_EXPIRED", "expired"),
    ("SUBSCRIPTION_STATE_PENDING", "pending"),
    ("SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED", "expired"),
    ("SUBSCRIPTION_STATE_UNSPECIFIED", "unknown"),
    ("SOMETHING_GOOGLE_ADDS_LATER", "unknown"),
])
def test_every_google_state_maps_to_one_of_ours(google, ours):
    assert play_state_from_purchase(_purchase(state=google)).status == ours


def test_every_mapped_status_fits_the_column():
    # subscription_status is VARCHAR(20).
    for google in ("SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"):
        assert len(play_state_from_purchase(_purchase(state=google)).status) <= 20


def test_paid_through_reads_nanosecond_timestamps():
    st = play_state_from_purchase(_purchase())
    assert st.paid_through == datetime(2026, 11, 1, 12, 0, 0, 123456, tzinfo=timezone.utc)


def test_paid_through_is_the_latest_line_item():
    p = _purchase()
    p["lineItems"].append({"productId": "ope_premium", "expiryTime": "2027-01-01T00:00:00Z"})
    assert play_state_from_purchase(p).paid_through == datetime(2027, 1, 1, tzinfo=timezone.utc)


def test_no_line_items_means_no_paid_through():
    p = _purchase()
    p["lineItems"] = []
    st = play_state_from_purchase(p)
    assert st.paid_through is None and st.product_ids == ()


def test_account_id_linked_token_ack_and_test_flags():
    p = _purchase(linkedPurchaseToken="old-token", testPurchase={},
                  acknowledgementState="ACKNOWLEDGEMENT_STATE_PENDING")
    st = play_state_from_purchase(p)
    assert st.account_id == play_account_id(USER)
    assert st.linked_purchase_token == "old-token"
    assert st.needs_acknowledgement is True
    assert st.is_test_purchase is True
    assert st.auto_renewing is True
    assert st.product_ids == ("ope_premium",)


def test_a_purchase_without_account_id_has_none():
    p = _purchase()
    del p["externalAccountIdentifiers"]
    assert play_state_from_purchase(p).account_id is None


def test_account_id_is_a_stable_hash_not_the_user_id():
    a = play_account_id(USER)
    assert a == play_account_id(USER)
    assert USER not in a and len(a) == 64
    assert a != play_account_id("someone-else")


def test_parse_rfc3339_variants():
    assert parse_rfc3339(None) is None
    assert parse_rfc3339("2026-01-01T00:00:00Z") == datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert parse_rfc3339("2026-01-01T00:00:00.5Z").microsecond == 500000


# ── the premium rule ─────────────────────────────────────────────────────────

def _premium(**kw):
    base = dict(tier="free", trial_ends_at=None, status="none", paid_through=None,
                granted=False, grant_ends_at=None)
    base.update(kw)
    return is_premium(NOW, **base)


def test_free_account_is_not_premium():
    assert not _premium()


def test_trial_until_its_end_and_not_after():
    assert _premium(tier="trial", trial_ends_at=NOW + timedelta(seconds=1))
    assert not _premium(tier="trial", trial_ends_at=NOW)


def test_active_until_paid_through_plus_one_day_of_leeway():
    assert _premium(status="active", paid_through=NOW - RENEWAL_LEEWAY + timedelta(seconds=1))
    assert not _premium(status="active", paid_through=NOW - RENEWAL_LEEWAY)


def test_active_without_a_date_is_a_legacy_row_and_stays_premium():
    assert _premium(status="active", paid_through=None)


def test_cancelled_keeps_premium_exactly_until_paid_through():
    assert _premium(status="cancelled", paid_through=NOW + timedelta(seconds=1))
    assert not _premium(status="cancelled", paid_through=NOW)
    assert not _premium(status="cancelled", paid_through=None)


def test_grace_period_keeps_premium_even_past_the_old_expiry():
    assert _premium(status="grace", paid_through=NOW - timedelta(days=5))


@pytest.mark.parametrize("status", ["on_hold", "paused", "expired", "pending", "unknown", "none"])
def test_states_without_entitlement(status):
    assert not _premium(status=status, paid_through=NOW + timedelta(days=30))


def test_naive_datetimes_from_the_database_are_treated_as_utc():
    naive = (NOW + timedelta(hours=1)).replace(tzinfo=None)
    assert _premium(status="cancelled", paid_through=naive)


def test_grant_without_end_date_is_premium():
    assert _premium(granted=True)


def test_grant_with_end_date_ends():
    assert _premium(granted=True, grant_ends_at=NOW + timedelta(days=1))
    assert not _premium(granted=True, grant_ends_at=NOW)


def test_grant_only_adds_premium_never_removes_it():
    # A paying owner whose grant has ended — or was never set — is still premium.
    assert _premium(status="active", paid_through=NOW + timedelta(days=10),
                    granted=True, grant_ends_at=NOW - timedelta(days=1))
    assert _premium(status="active", paid_through=NOW + timedelta(days=10), granted=False)


def test_refund_with_revocation_arrives_as_expired_and_ends_premium():
    st = play_state_from_purchase(_purchase(state="SUBSCRIPTION_STATE_EXPIRED",
                                            expiry="2026-11-01T00:00:00Z"))
    assert not _premium(status=st.status, paid_through=st.paid_through)

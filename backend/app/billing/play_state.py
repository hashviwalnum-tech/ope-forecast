"""Turn Google's description of a subscription into the few facts Ope stores.

Pure: takes the JSON body of Google's ``purchases.subscriptionsv2.get`` and
returns a :class:`PlayState`.  It never decides entitlement — that is
``entitlement.py`` — it only translates Google's vocabulary into ours, so the
Subscription row keeps one set of statuses whichever way premium was obtained.

What we deliberately take from Google, and why:

- ``subscriptionState`` → our status.  The whole lifecycle (renewal, cancel,
  grace, hold, pause, expiry, refund-with-revoke) is expressed through it.
- ``lineItems[].expiryTime`` → the paid-through date.  The latest one wins.
- ``externalAccountIdentifiers.obfuscatedExternalAccountId`` → which Ope account
  the phone said it was buying for.  The backend checks this against the
  signed-in caller, so a purchase token copied from someone else's phone cannot
  be redeemed on another account.
- ``linkedPurchaseToken`` → the token this one replaced (resubscribe/upgrade).
- ``acknowledgementState`` → Google refunds a purchase that is not acknowledged
  within three days, so the backend must notice when it still needs doing.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

_STATE_MAP = {
    "SUBSCRIPTION_STATE_ACTIVE": "active",
    "SUBSCRIPTION_STATE_CANCELED": "cancelled",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD": "grace",
    "SUBSCRIPTION_STATE_ON_HOLD": "on_hold",
    "SUBSCRIPTION_STATE_PAUSED": "paused",
    "SUBSCRIPTION_STATE_EXPIRED": "expired",
    "SUBSCRIPTION_STATE_PENDING": "pending",
    # A pending purchase the buyer never completed.  Nothing was ever paid.
    "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED": "expired",
}


@dataclass(frozen=True)
class PlayState:
    status: str
    paid_through: datetime | None
    product_ids: tuple[str, ...]
    account_id: str | None
    linked_purchase_token: str | None
    needs_acknowledgement: bool
    auto_renewing: bool
    is_test_purchase: bool
    raw_state: str = field(default="")


def play_account_id(user_id: str) -> str:
    """What the phone passes to Google as ``obfuscatedAccountId``.

    A hash, not the raw id: Google's guidance is that this field must not carry
    anything that identifies the person, and it ends up in Google's records.
    Served to the app in ``GET /subscription`` so the phone needs no crypto.
    """
    return hashlib.sha256(f"ope:{user_id}".encode("utf-8")).hexdigest()[:64]


_FRACTION = re.compile(r"\.(\d+)")


def parse_rfc3339(value: str | None) -> datetime | None:
    """Google writes up to nanoseconds ("…:05.123456789Z"); Python reads micro."""
    if not value:
        return None
    v = value.strip().replace("Z", "+00:00")
    v = _FRACTION.sub(lambda m: "." + m.group(1)[:6].ljust(6, "0"), v, count=1)
    dt = datetime.fromisoformat(v)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def play_state_from_purchase(purchase: dict) -> PlayState:
    raw = purchase.get("subscriptionState", "") or ""
    status = _STATE_MAP.get(raw, "unknown")

    items = purchase.get("lineItems") or []
    expiries = [parse_rfc3339(i.get("expiryTime")) for i in items]
    expiries = [e for e in expiries if e is not None]
    paid_through = max(expiries) if expiries else None
    product_ids = tuple(i["productId"] for i in items if i.get("productId"))
    auto_renewing = any(
        (i.get("autoRenewingPlan") or {}).get("autoRenewEnabled") for i in items
    )

    ids = purchase.get("externalAccountIdentifiers") or {}
    return PlayState(
        status=status,
        paid_through=paid_through,
        product_ids=product_ids,
        account_id=ids.get("obfuscatedExternalAccountId") or None,
        linked_purchase_token=purchase.get("linkedPurchaseToken") or None,
        needs_acknowledgement=(
            purchase.get("acknowledgementState") == "ACKNOWLEDGEMENT_STATE_PENDING"
        ),
        auto_renewing=auto_renewing,
        is_test_purchase="testPurchase" in purchase,
        raw_state=raw,
    )

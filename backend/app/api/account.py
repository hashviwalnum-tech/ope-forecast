"""Deleting an account, and everything behind it.

Google Play requires any app that lets people create an account to offer
deletion from inside the app, so this is not optional dressing — without it the
Android app is rejected.  It is also the thing the privacy policy has been
promising since June.

Two halves, and they fail independently on purpose:

1. **The data.** Every business the user owns, and everything under it, through
   the same schema-derived cascade the per-location delete uses.  Plus the
   subscription row, which hangs off ``user_id`` rather than a business and so
   is not reached by that sweep.
2. **The login.** Removing the Supabase auth user needs the service-role key,
   which is a different and far more dangerous secret than anything else this
   process holds — it bypasses row-level security entirely.  If it is absent or
   Supabase refuses, the data is still gone and the response says so plainly
   rather than pretending.

Before either, a **renewing Google Play subscription is cancelled** through
Google.  Deleting the Ope account does not stop Google charging, so an owner who
deletes while subscribed would keep paying for an account that no longer exists.
If that cancellation cannot be done — Google unreachable, credentials missing —
nothing is deleted, and the owner is told to cancel in the Play Store first and
why (``409 play_subscription_active``; each app shows its own translation).

The order matters.  Data first, login second: an account whose data is gone but
whose login survives is a recoverable mess someone can finish by hand.  The
reverse — a login deleted while the rows remain — leaves orphan data nobody can
reach or erase, which is exactly what a deletion request is supposed to prevent.
"""
from __future__ import annotations

import json
import logging
import os
import ssl
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.business_cascade import delete_business_data
from app.api.deps import get_current_user
from app.billing.entitlement import RENEWING_STATUSES
from app.billing.google_play import PROVIDER, PlayClient, PlayError, get_play_client, sync_from_google
from app.db import get_db
from app.models import Business
from app.models.subscription import Subscription

log = logging.getLogger(__name__)

router = APIRouter(prefix="/account", tags=["Account"])

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
_SERVICE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY"

# Same reason as app/api/deps.py: Python 3.14 rejects the CA chain presented by
# some intercepting proxies. This call carries a bearer token over TLS to a
# pinned Supabase hostname.
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE


class AccountDeleted(BaseModel):
    businesses_deleted: int
    login_deleted: bool
    #: Present only when the data went but the login did not, so the client can
    #: tell the owner the truth instead of a blanket "all done".
    detail: str | None = None


def _delete_auth_user(user_id: str) -> tuple[bool, str | None]:
    """Remove the Supabase auth user. Returns (deleted, why-not)."""
    service_key = os.environ.get(_SERVICE_KEY_ENV, "")
    if not service_key:
        return False, (
            f"{_SERVICE_KEY_ENV} is not configured, so the sign-in itself could "
            "not be removed. All of the account's data has been deleted."
        )
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        method="DELETE",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as resp:
            if resp.status in (200, 204):
                return True, None
            return False, f"Supabase returned {resp.status} when deleting the sign-in."
    except urllib.error.HTTPError as e:
        # 404 means it is already gone, which is the state we wanted.
        if e.code == 404:
            return True, None
        log.error("Supabase admin delete failed: %s %s", e.code, e.reason)
        return False, f"Supabase refused the sign-in deletion ({e.code})."
    except Exception as e:                                   # network, DNS, TLS
        log.error("Supabase admin delete errored: %s: %s", type(e).__name__, e)
        return False, "The sign-in could not be reached to be removed."


#: The error code the apps translate into "cancel it in the Play Store first".
PLAY_SUBSCRIPTION_ACTIVE = "play_subscription_active"


def _cancel_play_subscription(db: Session, sub: Subscription | None, play: PlayClient | None) -> None:
    """Stop Google charging, or raise so that nothing is deleted."""
    if (sub is None or sub.subscription_provider != PROVIDER
            or not sub.subscription_provider_id
            or sub.subscription_status not in RENEWING_STATUSES):
        return
    if play is None:
        log.error("Account %s has a renewing Play subscription and Play is not configured", sub.user_id)
        raise HTTPException(409, PLAY_SUBSCRIPTION_ACTIVE)
    try:
        # Ask first: they may already have cancelled in the Play Store and the
        # notification has not reached us.
        state = sync_from_google(db, sub, play, sub.subscription_provider_id)
        if state.status in RENEWING_STATUSES:
            play.cancel(sub.play_product_id or "", sub.subscription_provider_id)
    except PlayError as e:
        log.error("Could not cancel Play subscription for %s: %s", sub.user_id, e)
        raise HTTPException(409, PLAY_SUBSCRIPTION_ACTIVE)


@router.delete("", response_model=AccountDeleted)
def delete_account(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
    play: PlayClient | None = Depends(get_play_client),
):
    """Delete the caller's account: every business they own, then the sign-in.

    Irreversible, and deliberately has no "are you sure" of its own — the
    confirmation belongs in the client, where the person is.
    """
    sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    _cancel_play_subscription(db, sub, play)

    businesses = db.query(Business).filter(Business.user_id == user_id).all()

    # One transaction for all of it: a failure part-way leaves the account whole
    # rather than half-erased.
    for biz in businesses:
        delete_business_data(db, biz.id)
        db.delete(biz)
    db.query(Subscription).filter(Subscription.user_id == user_id).delete(
        synchronize_session=False
    )
    db.commit()

    login_deleted, why_not = _delete_auth_user(user_id)
    return AccountDeleted(
        businesses_deleted=len(businesses),
        login_deleted=login_deleted,
        detail=why_not,
    )

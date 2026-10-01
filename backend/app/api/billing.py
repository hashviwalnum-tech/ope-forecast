"""Google Play purchases: the phone reports one, Google says what it is.

Two ways news reaches the backend, and neither trusts its messenger:

``POST /billing/google/verify``  the phone, straight after a purchase, sends the
    purchase token.  The backend asks Google what that token is and stores
    Google's answer.  Nothing the phone says about price, product or status is
    believed — the token is only used as a question to Google.

``POST /billing/google/rtdn``    Google's Real-time Developer Notifications,
    pushed through Pub/Sub, for everything afterwards: renewals, cancellations,
    failed payments (grace / hold), pauses, expiry, refunds.  The push is
    authenticated (a Google-signed token), and even then its contents are only a
    hint: the backend re-asks Google about the token and stores that.

Both end in ``sync_from_google``, so there is one code path that writes a Play
subscription onto the Subscription row.
"""
from __future__ import annotations

import base64
import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.subscriptions import _get_or_create_subscription
from app.billing.google_play import (
    PlayClient, PlayError, get_play_client, package_name,
    premium_product_ids, sync_from_google,
)
from app.billing.play_state import play_account_id, play_state_from_purchase
from app.db import get_db
from app.models.subscription import Subscription
from app.schemas.subscription import PlayVerifyRequest, SubscriptionRead

log = logging.getLogger(__name__)

router = APIRouter(prefix="/billing/google", tags=["Billing"])


def _require_client(play: PlayClient | None) -> PlayClient:
    if play is None:
        # A code, not prose: the phone shows its own translated message.
        raise HTTPException(503, "play_not_configured")
    return play


@router.post("/verify", response_model=SubscriptionRead)
def verify_purchase(
    body: PlayVerifyRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
    play: PlayClient | None = Depends(get_play_client),
):
    client = _require_client(play)
    token = body.purchase_token.strip()
    if not token:
        raise HTTPException(400, "purchase_token is required")
    if body.product_id not in premium_product_ids():
        raise HTTPException(400, "unknown_product")

    # One purchase, one account.
    owner = (db.query(Subscription)
             .filter(Subscription.subscription_provider_id == token,
                     Subscription.user_id != user_id)
             .first())
    if owner is not None:
        raise HTTPException(409, "purchase_belongs_to_another_account")

    try:
        purchase = client.get(token)
    except PlayError as e:
        if e.not_found:
            raise HTTPException(400, "purchase_not_found")
        log.error("Play verify failed for %s: %s", user_id, e)
        raise HTTPException(502, "play_unreachable")

    state = play_state_from_purchase(purchase)
    if body.product_id not in state.product_ids:
        raise HTTPException(400, "unknown_product")
    if state.account_id != play_account_id(user_id):
        # Either a token lifted from another phone, or a purchase made without
        # the account id — which our app never does.  Both are refused.
        log.warning("Play token presented by %s carries a different account id", user_id)
        raise HTTPException(403, "purchase_belongs_to_another_account")

    sub = _get_or_create_subscription(user_id, db)
    sync_from_google(db, sub, client, token)
    db.refresh(sub)
    return sub


# ── Real-time Developer Notifications ────────────────────────────────────────

def verify_pubsub_push(request: Request) -> None:
    """Reject anything that is not a push signed by Google for our subscription.

    Pub/Sub, with authentication turned on, sends an OIDC token signed by
    Google whose audience is the value configured on the push subscription and
    whose email is the service account it pushes as.  Both must match.  With
    either unset on the server the endpoint refuses everything — an open
    endpoint here would let anyone make the backend re-check arbitrary tokens.
    """
    audience = os.environ.get("GOOGLE_RTDN_AUDIENCE", "")
    pusher = os.environ.get("GOOGLE_RTDN_SERVICE_ACCOUNT", "")
    if not audience or not pusher:
        raise HTTPException(503, "rtdn_not_configured")
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "missing token")
    try:
        from google.auth.transport import requests as g_requests
        from google.oauth2 import id_token
        claims = id_token.verify_oauth2_token(auth[7:], g_requests.Request(), audience=audience)
    except Exception as e:
        log.warning("RTDN push with an invalid token: %s", e)
        raise HTTPException(401, "invalid token")
    if claims.get("email") != pusher or not claims.get("email_verified"):
        raise HTTPException(403, "wrong sender")


def _find_subscription(db: Session, token: str, client: PlayClient) -> Subscription | None:
    """Which account a notification is about.

    Usually the token is already on a row.  A brand-new or replacement token may
    not be — the phone may have died before calling /verify, and Google refunds
    a purchase nobody acknowledges.  So ask Google: a replacement names the
    token it replaced, and every purchase from our app carries the hashed
    account id.
    """
    sub = db.query(Subscription).filter(Subscription.subscription_provider_id == token).first()
    if sub is not None:
        return sub
    try:
        state = play_state_from_purchase(client.get(token))
    except PlayError as e:
        if e.not_found:
            return None
        raise
    if state.linked_purchase_token:
        sub = (db.query(Subscription)
               .filter(Subscription.subscription_provider_id == state.linked_purchase_token)
               .first())
        if sub is not None:
            return sub
    if state.account_id:
        for candidate in db.query(Subscription).all():
            if play_account_id(candidate.user_id) == state.account_id:
                return candidate
    return None


@router.post("/rtdn")
async def google_notification(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(verify_pubsub_push),
    play: PlayClient | None = Depends(get_play_client),
):
    client = _require_client(play)
    envelope = await request.json()
    try:
        data = json.loads(base64.b64decode(envelope["message"]["data"]))
    except Exception:
        # Malformed beyond use; acknowledge so Pub/Sub does not retry forever.
        log.error("RTDN message could not be decoded")
        return {"ok": True, "ignored": "undecodable"}

    if data.get("packageName") and data["packageName"] != package_name():
        return {"ok": True, "ignored": "other package"}
    if "testNotification" in data:
        log.info("RTDN test notification received")
        return {"ok": True, "test": True}

    note = data.get("subscriptionNotification") or data.get("voidedPurchaseNotification")
    token = (note or {}).get("purchaseToken")
    if not token:
        return {"ok": True, "ignored": "not a subscription"}

    try:
        sub = _find_subscription(db, token, client)
        if sub is None:
            log.warning("RTDN for a Play token no account claims")
            return {"ok": True, "ignored": "unknown token"}
        sync_from_google(db, sub, client, token)
    except PlayError as e:
        # A 500 makes Pub/Sub redeliver, which is what we want if Google blinked.
        log.error("RTDN could not reach Google: %s", e)
        raise HTTPException(500, "play_unreachable")
    return {"ok": True}

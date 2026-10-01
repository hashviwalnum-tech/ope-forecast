"""Talking to Google Play — the only module in Ope that does.

Everything here is I/O.  The translation of Google's answer is in
``play_state.py`` and the entitlement rule in ``entitlement.py``, both pure and
tested without a network.  This file is deliberately thin so that the parts
which *can* be wrong without Google credentials are not in it.

Configuration (all on the backend host, none of it in either app):

``GOOGLE_PLAY_SERVICE_ACCOUNT_JSON``  the service-account key, pasted whole.
                                      Without it nothing here can run, and the
                                      endpoints say so with a 503 rather than
                                      guessing.
``GOOGLE_PLAY_PACKAGE_NAME``          defaults to the app's id.
``GOOGLE_PLAY_PRODUCT_IDS``           comma-separated subscription ids that
                                      grant premium; defaults to ``ope_premium``.
``GOOGLE_RTDN_AUDIENCE``              the audience set on the Pub/Sub push
                                      subscription (usually the endpoint URL).
``GOOGLE_RTDN_SERVICE_ACCOUNT``       the account Pub/Sub signs pushes as.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Protocol

from sqlalchemy.orm import Session

from app import clock
from app.billing.entitlement import subscription_is_entitled
from app.billing.play_state import PlayState, play_state_from_purchase
from app.models.subscription import Subscription

log = logging.getLogger(__name__)

PROVIDER = "google_play"
DEFAULT_PACKAGE = "com.opeforecast.app"


def package_name() -> str:
    return os.environ.get("GOOGLE_PLAY_PACKAGE_NAME", DEFAULT_PACKAGE)


def premium_product_ids() -> frozenset[str]:
    raw = os.environ.get("GOOGLE_PLAY_PRODUCT_IDS", "ope_premium")
    return frozenset(p.strip() for p in raw.split(",") if p.strip())


class PlayError(Exception):
    """Google could not be asked, or refused.  ``not_found`` = bad token."""

    def __init__(self, message: str, *, not_found: bool = False):
        super().__init__(message)
        self.not_found = not_found


class PlayClient(Protocol):
    def get(self, token: str) -> dict: ...
    def acknowledge(self, product_id: str, token: str) -> None: ...
    def cancel(self, product_id: str, token: str) -> None: ...


class GoogleApiPlayClient:
    """The real thing: Android Publisher API v3 with a service account."""

    def __init__(self, service_account_info: dict, package: str):
        from google.oauth2 import service_account          # lazy: heavy import
        from googleapiclient.discovery import build

        creds = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=["https://www.googleapis.com/auth/androidpublisher"],
        )
        self._purchases = build(
            "androidpublisher", "v3", credentials=creds, cache_discovery=False
        ).purchases()
        self._package = package

    def _run(self, request):
        from googleapiclient.errors import HttpError
        try:
            return request.execute(num_retries=2)
        except HttpError as e:
            status = getattr(e.resp, "status", None)
            raise PlayError(f"Google Play returned {status}", not_found=status in (400, 404, 410)) from e
        except Exception as e:                                     # network, auth
            raise PlayError(f"{type(e).__name__}: {e}") from e

    def get(self, token: str) -> dict:
        return self._run(self._purchases.subscriptionsv2().get(
            packageName=self._package, token=token))

    def acknowledge(self, product_id: str, token: str) -> None:
        self._run(self._purchases.subscriptions().acknowledge(
            packageName=self._package, subscriptionId=product_id, token=token, body={}))

    def cancel(self, product_id: str, token: str) -> None:
        self._run(self._purchases.subscriptions().cancel(
            packageName=self._package, subscriptionId=product_id, token=token))


def get_play_client() -> PlayClient | None:
    """FastAPI dependency.  ``None`` means "not configured on this server"."""
    raw = os.environ.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        return None
    try:
        return GoogleApiPlayClient(json.loads(raw), package_name())
    except Exception as e:                                         # bad JSON, bad key
        log.error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is set but unusable: %s", e)
        return None


def apply_play_state(sub: Subscription, state: PlayState, token: str) -> None:
    """Write Google's answer onto the existing Subscription row.

    The same columns the trial and every other path use — no parallel table.
    The manual grant and the trial columns are never touched, so a grant
    survives anything Google says, and Google's answer survives a grant.
    """
    sub.subscription_provider = PROVIDER
    sub.subscription_provider_id = token
    pid = next(iter(p for p in state.product_ids if p in premium_product_ids()), None)
    if pid:
        sub.play_product_id = pid
    sub.subscription_status = state.status
    sub.renewal_at = state.paid_through
    if subscription_is_entitled(clock.now_utc(), state.status, state.paid_through):
        sub.tier = "premium"
    sub.updated_at = clock.now_utc()


def sync_from_google(db: Session, sub: Subscription, client: PlayClient, token: str) -> PlayState:
    """Ask Google for the truth about ``token``, store it, acknowledge if due.

    Never trusts anything the phone or a notification claimed — the only input
    taken from outside is the token, and Google is asked what it means.
    """
    state = play_state_from_purchase(client.get(token))
    apply_play_state(sub, state, token)
    db.commit()
    if state.needs_acknowledgement and state.status in ("active", "grace"):
        # After the commit: the owner has their premium even if this fails, and
        # the next notification or refresh will retry it.  Google refunds
        # purchases left unacknowledged for three days, so it is logged loudly.
        try:
            client.acknowledge(sub.play_product_id or "", token)
        except PlayError as e:
            log.error("Could not acknowledge Play purchase for %s: %s", sub.user_id, e)
    return state

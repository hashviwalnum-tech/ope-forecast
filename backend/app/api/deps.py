import logging
import os
import secrets
import ssl

import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.engine.limits import FREE, PREMIUM, Tier
from app.models import Business

log = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]

# Python 3.14 enforces stricter CA cert validation (Basic Constraints must be
# critical) which breaks on HUJI's network SSL interceptor. The JWKS endpoint
# only serves public keys, so skipping chain verification here is acceptable.
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

_jwks_client = PyJWKClient(
    f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
    ssl_context=_ssl_ctx,
)


def get_current_user(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")
    token = auth[7:]
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
        )
        return payload["sub"]
    except Exception as e:
        log.warning("JWT verification failed: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_admin_key(request: Request) -> None:
    """Blocks access unless the caller supplies the correct X-Admin-Key header.

    Set ADMIN_KEY in the environment. If unset, the endpoint is always forbidden
    (safe default for production before billing is wired up).
    """
    expected = os.environ.get("ADMIN_KEY", "")
    if not expected:
        raise HTTPException(status_code=403, detail="Admin key not configured")
    provided = request.headers.get("X-Admin-Key", "")
    if not secrets.compare_digest(expected, provided):
        raise HTTPException(status_code=403, detail="Invalid admin key")


def resolve_tier(db: Session, user_id: str) -> Tier:
    """**The only way to obtain a Tier.**  Reads authoritative state, every time.

    The tier used to live in ``Business.settings["tier"]`` — a cache written when
    a trial started and only written back down if the client happened to call
    ``GET /subscription``.  Every entitlement leak found in testing was some code
    path reading that cache without refreshing it: the 30-day trial that never
    actually ended, and three Telegram bot gates that kept serving premium
    history depth to expired accounts because that path never touched the
    refresh at all.

    There is no cache now.  This reads the ``Subscription`` row, which is the
    source of truth, and returns a ``Tier`` — a type the limit helpers require,
    so no caller can reach a gate without having come through here.

    One deliberate exception: an explicit admin grant
    (``settings["tier_admin_override"]``, set only by the admin-key
    ``PATCH /businesses/me/tier``) pins a tier for testing until billing exists.
    That is a manual act behind the server's own key, not a stale value.
    """
    from app.models.subscription import Subscription  # local: avoids an import cycle

    businesses = db.query(Business).filter(Business.user_id == user_id).all()
    for b in businesses:
        settings = b.settings or {}
        if settings.get("tier_admin_override"):
            granted = settings.get("tier")
            if granted in (FREE, PREMIUM):
                return Tier(granted)

    sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    return Tier(sub.effective_tier if sub is not None else FREE)


def get_tier(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> Tier:
    """FastAPI dependency form of :func:`resolve_tier`.

    Endpoints that gate on entitlements declare ``tier: Tier = Depends(get_tier)``
    and pass it explicitly to whatever needs it.
    """
    return resolve_tier(db, user_id)


def get_business(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> Business:
    query = db.query(Business).filter(Business.user_id == user_id)
    biz_id_header = request.headers.get("X-Business-Id")
    if biz_id_header is not None:
        try:
            biz = query.filter(Business.id == int(biz_id_header)).first()
            if biz:
                return biz
        except ValueError:
            pass
    biz = query.order_by(Business.id).first()
    if not biz:
        raise HTTPException(status_code=404, detail="No business yet. Create one to get started.")
    return biz

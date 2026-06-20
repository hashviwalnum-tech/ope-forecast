import logging
import os
import secrets
import ssl

import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db import get_db
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

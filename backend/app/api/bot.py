"""
Service-authenticated endpoints for the Telegram bot.

Every route requires an X-Bot-Service-Key header that matches the BOT_SERVICE_KEY
environment variable — a shared secret the bot holds on its server, never exposed
to Telegram users or the owner.  The bot identifies the business by supplying the
?chat_id= that was established during the /link flow.
"""
import os
from datetime import datetime, timezone

def _utcnow() -> datetime:
    return clock.now_naive_utc()

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.analytics import get_forecast as _analytics_forecast
from app.api.analytics import get_ordering as _analytics_ordering
from app.api.nudges import (
    _compute_nudge,
    _is_frequency_capped,
    _record_nudge_sent,
    _send_telegram_message,
)
from app.db import get_db
from app.api.deps import sync_user_tier
from app.models import Business, Product, SaleEvent
from app.models.telegram_link import TelegramLink
from app.schemas.telegram import BotLogSaleRequest, BotLogSaleResponse
from app import clock

router = APIRouter(prefix="/bot", tags=["Bot"])


# ── auth helpers ─────────────────────────────────────────────────────────────

def _verify_service_key(request: Request) -> None:
    """Raise 401 if the request does not carry the correct BOT_SERVICE_KEY."""
    expected = os.environ.get("BOT_SERVICE_KEY", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Bot service not configured on this server")
    provided = request.headers.get("X-Bot-Service-Key", "")
    if provided != expected:
        raise HTTPException(status_code=401, detail="Invalid service key")


def _business_for_chat(chat_id: str, db: Session) -> Business:
    """Look up the business linked to chat_id, or 404."""
    link = (
        db.query(TelegramLink)
        .filter(TelegramLink.chat_id == chat_id)
        .first()
    )
    if not link:
        raise HTTPException(
            status_code=404,
            detail="This Telegram chat is not linked to any Ope business. "
                   "Use /link in the bot to connect your account.",
        )
    biz = db.get(Business, link.business_id)
    if not biz:
        raise HTTPException(status_code=404, detail="Linked business not found")
    # Resolve the LIVE tier before handing this business to anything that gates
    # on it.  This path loads the business directly rather than through
    # get_business, so without this the bot served a cached tier flag — an
    # expired trial kept premium history depth in its forecasts indefinitely,
    # and because the bot never touches get_business, nothing on this path ever
    # refreshed the flag either.
    sync_user_tier(db, biz.user_id)
    db.refresh(biz)
    return biz


# ── /bot/forecast ─────────────────────────────────────────────────────────────

@router.get("/forecast")
def bot_get_forecast(
    request: Request,
    chat_id: str = Query(..., description="Telegram chat_id established during /link"),
    db: Session = Depends(get_db),
):
    """Return the 7-day customer forecast for the business linked to chat_id."""
    _verify_service_key(request)
    biz = _business_for_chat(chat_id, db)
    return _analytics_forecast(db=db, biz=biz)


# ── /bot/ordering ─────────────────────────────────────────────────────────────

@router.get("/ordering")
def bot_get_ordering(
    request: Request,
    chat_id: str = Query(..., description="Telegram chat_id"),
    db: Session = Depends(get_db),
):
    """Return ordering recommendations for the business linked to chat_id."""
    _verify_service_key(request)
    biz = _business_for_chat(chat_id, db)
    return _analytics_ordering(db=db, biz=biz)


# ── /bot/log-sale ─────────────────────────────────────────────────────────────

@router.post("/log-sale", response_model=BotLogSaleResponse, status_code=201)
def bot_log_sale(
    request: Request,
    body: BotLogSaleRequest,
    chat_id: str = Query(..., description="Telegram chat_id"),
    db: Session = Depends(get_db),
):
    """Log a sale event (tap) for the business linked to chat_id.

    Matches product by exact name first, then by case-insensitive prefix.
    """
    _verify_service_key(request)
    biz = _business_for_chat(chat_id, db)

    products = db.query(Product).filter_by(business_id=biz.id).all()
    name_lower = body.product_name.strip().lower()

    # Exact match first (case-insensitive)
    product = next((p for p in products if p.name.lower() == name_lower), None)
    if product is None:
        # Prefix match
        product = next((p for p in products if p.name.lower().startswith(name_lower)), None)
    if product is None:
        names = ", ".join(p.name for p in products) if products else "(no products defined)"
        raise HTTPException(
            status_code=404,
            detail=f"No product found matching '{body.product_name}'. Available: {names}",
        )

    event = SaleEvent(
        business_id=biz.id,
        product_id=product.id,
        timestamp=_utcnow(),
        quantity=body.quantity,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    return BotLogSaleResponse(
        ok=True,
        product=product.name,
        quantity=body.quantity,
        timestamp=event.timestamp.isoformat(),
    )


# ── /bot/nudge/send-all ───────────────────────────────────────────────────────

@router.post("/nudge/send-all", response_model=list[dict])
def bot_send_all_nudges(
    request: Request,
    db: Session = Depends(get_db),
):
    """Send proactive nudges to all linked Telegram chats that qualify.

    Called by a cron job or the bot service (requires X-Bot-Service-Key).
    For each linked business:
      - skips if nudges_enabled=False
      - skips if frequency cap not expired
      - skips if no nudge is warranted (no genuine deviation or stock issue)
      - sends if TELEGRAM_BOT_TOKEN is set and a chat_id is linked
    Returns a summary list of outcomes.
    """
    _verify_service_key(request)

    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not bot_token:
        return [{"status": "skipped", "reason": "no_bot_token"}]

    links = db.query(TelegramLink).filter(TelegramLink.chat_id.isnot(None)).all()
    results = []

    for link in links:
        biz = db.get(Business, link.business_id)
        if biz is not None:
            sync_user_tier(db, biz.user_id)   # same reason as _business_for_chat
            db.refresh(biz)
        if not biz:
            continue

        settings = biz.settings or {}
        if not settings.get("nudges_enabled", True):
            results.append({"business_id": biz.id, "status": "skipped", "reason": "nudges_disabled"})
            continue

        if _is_frequency_capped(biz):
            results.append({"business_id": biz.id, "status": "skipped", "reason": "frequency_cap"})
            continue

        nudge = _compute_nudge(db, biz)
        if nudge is None:
            results.append({"business_id": biz.id, "status": "skipped", "reason": "nothing_to_nudge"})
            continue

        try:
            _send_telegram_message(link.chat_id, f"Ope: {nudge.message}", bot_token)
            _record_nudge_sent(db, biz)
            results.append({"business_id": biz.id, "status": "sent", "type": nudge.type})
        except Exception as e:
            results.append({"business_id": biz.id, "status": "error", "detail": str(e)})

    return results

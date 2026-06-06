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
    return datetime.now(timezone.utc).replace(tzinfo=None)

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.analytics import get_forecast as _analytics_forecast
from app.api.analytics import get_ordering as _analytics_ordering
from app.db import get_db
from app.models import Business, Product, SaleEvent
from app.models.telegram_link import TelegramLink
from app.schemas.telegram import BotLogSaleRequest, BotLogSaleResponse

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

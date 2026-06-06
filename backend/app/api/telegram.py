"""
Owner-authenticated Telegram linking endpoints.

Flow:
  1. Owner clicks "Generate Code" in Settings  →  POST /telegram/link-code
  2. Owner sends /link <CODE> to the Telegram bot
  3. Bot calls POST /telegram/redeem with the code + chat_id
  4. Backend stores chat_id ↔ business_id in TelegramLink
  5. Owner can view/revoke via GET/DELETE /telegram/link
"""
import secrets
from datetime import datetime, timedelta, timezone

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import Business
from app.models.telegram_link import TelegramLink
from app.schemas.telegram import (
    TelegramLinkCodeResponse,
    TelegramLinkStatus,
    TelegramRedeemRequest,
    TelegramRedeemResponse,
)

router = APIRouter(prefix="/telegram", tags=["Telegram"])

LINK_CODE_EXPIRES_MINUTES = 60


@router.post("/link-code", response_model=TelegramLinkCodeResponse)
def generate_link_code(
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Generate (or refresh) a one-time link code for the current business."""
    code = secrets.token_urlsafe(24)
    expires = _utcnow() + timedelta(minutes=LINK_CODE_EXPIRES_MINUTES)

    row = db.query(TelegramLink).filter_by(business_id=biz.id).first()
    if row:
        row.link_code = code
        row.link_code_expires_at = expires
    else:
        row = TelegramLink(
            business_id=biz.id,
            link_code=code,
            link_code_expires_at=expires,
        )
        db.add(row)

    db.commit()
    return TelegramLinkCodeResponse(code=code, expires_in_minutes=LINK_CODE_EXPIRES_MINUTES)


@router.get("/link", response_model=TelegramLinkStatus)
def get_link_status(
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Get the current Telegram link status for this business."""
    row = db.query(TelegramLink).filter_by(business_id=biz.id).first()
    if not row:
        return TelegramLinkStatus(linked=False)
    if row.chat_id:
        return TelegramLinkStatus(linked=True, chat_id=row.chat_id)
    # Pending, unredeemed code
    still_valid = row.link_code is not None and (
        row.link_code_expires_at is None
        or row.link_code_expires_at > _utcnow()
    )
    return TelegramLinkStatus(linked=False, has_pending_code=still_valid)


@router.delete("/link", status_code=204)
def revoke_link(
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Revoke the Telegram link (and any pending code) for this business."""
    row = db.query(TelegramLink).filter_by(business_id=biz.id).first()
    if row:
        db.delete(row)
        db.commit()


@router.post("/redeem", response_model=TelegramRedeemResponse)
def redeem_link_code(
    body: TelegramRedeemRequest,
    db: Session = Depends(get_db),
):
    """Redeem a one-time link code with a Telegram chat_id.

    Called by the bot (no owner auth needed — the code itself is the credential).
    After redemption the code is cleared and the chat_id is stored.
    """
    row = db.query(TelegramLink).filter(TelegramLink.link_code == body.code).first()
    if not row:
        raise HTTPException(status_code=404, detail="Invalid or expired link code")
    if row.link_code_expires_at and row.link_code_expires_at < _utcnow():
        raise HTTPException(status_code=404, detail="Invalid or expired link code")

    row.chat_id = body.chat_id
    row.link_code = None
    row.link_code_expires_at = None
    db.commit()

    biz = db.get(Business, row.business_id)
    return TelegramRedeemResponse(ok=True, business_name=biz.name if biz else "Unknown")

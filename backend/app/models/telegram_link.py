from __future__ import annotations

from datetime import datetime, timezone

def _utcnow() -> datetime:
    return clock.now_naive_utc()
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app import clock


class TelegramLink(Base):
    __tablename__ = "telegram_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), nullable=False, index=True)
    # Set after the owner redeems a link code in the bot
    chat_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    # One-time code generated in the web app; cleared on redemption
    link_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    link_code_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

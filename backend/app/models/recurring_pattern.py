from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.types import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class RecurringPattern(Base):
    """An owner-declared recurring bump: e.g. 'school trip every Sunday 9–11am'.

    weekdays is a JSON list of ints (0=Mon … 6=Sun).
    These days are folded into the forecast as expected and never flagged as anomalies.
    """

    __tablename__ = "recurring_patterns"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    label: Mapped[str] = mapped_column(String(200))
    weekdays: Mapped[list] = mapped_column(JSON, default=list)
    hour_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    hour_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    effect: Mapped[str] = mapped_column(String(20), default="higher")

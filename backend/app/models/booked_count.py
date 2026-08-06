from __future__ import annotations
from datetime import date as _date
from sqlalchemy import Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class BookedCount(Base):
    """Owner-recorded expected/booked appointment count for a date.

    Appointment-business context (spec: booking-aware demand) — the engine
    blends this with the statistical forecast (app/engine/booking.py).
    Freely editable any time, past or future: future dates are the owner's
    running booking estimate, past dates become training data once that
    day's actual customers are logged.
    """
    __tablename__ = "booked_counts"
    __table_args__ = (UniqueConstraint("business_id", "date", name="uq_booked_count_business_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    date: Mapped[_date] = mapped_column(Date, index=True)
    booked_count: Mapped[int]

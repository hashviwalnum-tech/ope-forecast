from __future__ import annotations
from datetime import date as _date
from sqlalchemy import Date, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

class RegularDailySpend(Base):
    __tablename__ = "regular_daily_spends"
    __table_args__ = (UniqueConstraint("regular_id", "date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    regular_id: Mapped[int] = mapped_column(ForeignKey("regulars.id", ondelete="CASCADE"), index=True)
    date: Mapped[_date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Float)

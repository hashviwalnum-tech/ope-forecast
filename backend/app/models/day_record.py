from __future__ import annotations

from datetime import date as _date
from typing import Optional

from sqlalchemy import Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DayRecord(Base):
    __tablename__ = "day_records"
    __table_args__ = (UniqueConstraint("business_id", "date", name="uq_day_record_business_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    date: Mapped[_date] = mapped_column(Date, index=True)
    customers: Mapped[int]
    notes: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    # NULL=normal, 'flagged'=unreviewed outlier, 'kept'=user confirmed valid,
    # 'excluded'=user marked as fluke, 'event'=user marked as real event
    outlier_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

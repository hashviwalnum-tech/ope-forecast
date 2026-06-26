from __future__ import annotations

from datetime import date as _date
from typing import Optional

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Regular(Base):
    """A named repeat customer tracked separately from demand history.

    CLV = visit_frequency_per_week * 52 * avg_spend * expected_lifespan_years
    Lives entirely outside DayRecord / SaleEvent demand data.
    """

    __tablename__ = "regulars"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    visit_frequency_per_week: Mapped[float] = mapped_column(Float)
    avg_spend: Mapped[float] = mapped_column(Float)
    expected_lifespan_years: Mapped[float] = mapped_column(Float, default=3.0)
    notes: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    visit_count: Mapped[int] = mapped_column(Integer, default=0)
    first_visit_date: Mapped[Optional[_date]] = mapped_column(Date, nullable=True)
    last_visit_date: Mapped[Optional[_date]] = mapped_column(Date, nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)

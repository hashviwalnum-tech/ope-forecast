from __future__ import annotations

from datetime import date as _date
from typing import Optional

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Period(Base):
    """A date range tagged as an event or ad campaign.

    These rows are excluded from the 'normal' baseline when training forecasting
    models, and are used to measure lift against that baseline.
    target_product_id: when set, lift analysis measures effect on this product's
    sales rather than total customers (NULL → measure total customers, spec §5).
    """

    __tablename__ = "periods"
    __table_args__ = (
        CheckConstraint("type IN ('event', 'ad')", name="period_type_check"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    start_date: Mapped[_date] = mapped_column(Date)
    end_date: Mapped[_date] = mapped_column(Date)
    type: Mapped[str] = mapped_column(String(10))
    label: Mapped[str] = mapped_column(String(200))
    cost: Mapped[Optional[float]] = mapped_column(nullable=True)
    target_product_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("products.id"), nullable=True
    )

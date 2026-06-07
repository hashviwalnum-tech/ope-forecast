from __future__ import annotations

from datetime import date as _date

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OrderRecord(Base):
    __tablename__ = "order_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    ordered_date: Mapped[_date] = mapped_column(Date, index=True)
    quantity: Mapped[float]
    expected_arrival_date: Mapped[_date] = mapped_column(Date)
    # 'pending' | 'arrived' | 'cancelled'
    status: Mapped[str] = mapped_column(String(20), default="pending")

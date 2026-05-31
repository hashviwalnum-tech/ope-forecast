from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SaleEvent(Base):
    __tablename__ = "sale_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    # nullable — a tap can record "a customer" with no specific product
    product_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("products.id"), nullable=True, index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)
    quantity: Mapped[float] = mapped_column(default=1.0)
    unit_price: Mapped[Optional[float]] = mapped_column(nullable=True)

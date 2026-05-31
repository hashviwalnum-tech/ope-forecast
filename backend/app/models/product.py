from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(50))
    current_stock: Mapped[Optional[float]] = mapped_column(nullable=True)
    lead_time_days: Mapped[int]
    holding_cost: Mapped[Optional[float]] = mapped_column(nullable=True)
    order_cost: Mapped[Optional[float]] = mapped_column(nullable=True)

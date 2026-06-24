from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ServiceConsumable(Base):
    """Links a service product to a stocked consumable it uses per performance.

    When a service (e.g. massage) is performed, it depletes qty_per_performance
    units of the linked consumable (e.g. massage oil).  The consumable is a
    regular stocked product with its own stock/reorder/batch tracking.
    """

    __tablename__ = "service_consumables"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    service_product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id"), index=True
    )
    consumable_product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id"), index=True
    )
    qty_per_performance: Mapped[float] = mapped_column(Float)

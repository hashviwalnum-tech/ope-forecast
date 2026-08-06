from __future__ import annotations
from datetime import date as _date
from sqlalchemy import Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class ServiceBookedCount(Base):
    """Per-service booked-appointment count for a date (appointment businesses).

    Sibling to BookedCount (the whole-business total) — a business with
    multiple services (e.g. a spa's "Massage" and "Haircut") can enter a
    separate booked count per service per date, so each service's own
    demand forecast (app/api/analytics.py get_product_forecast) can blend
    its own booking signal (app/engine/booking.py).
    """
    __tablename__ = "service_booked_counts"
    __table_args__ = (
        UniqueConstraint("business_id", "product_id", "date", name="uq_service_booked_count"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    date: Mapped[_date] = mapped_column(Date, index=True)
    booked_count: Mapped[int]

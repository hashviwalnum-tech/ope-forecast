from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SaleRecord(Base):
    __tablename__ = "sale_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    day_record_id: Mapped[int] = mapped_column(ForeignKey("day_records.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    units_sold: Mapped[float]

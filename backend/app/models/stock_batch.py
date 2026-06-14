from __future__ import annotations

from datetime import date as _date

from sqlalchemy import Date, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class StockBatch(Base):
    """One dated batch of stock.

    Each reorder and each initial stock-setting creates a batch.
    Sales deplete the oldest batch first (FIFO).
    expiry_date = arrival_date + product.shelf_life_days (NULL when no shelf life).
    source: 'initial' for the first stock count, 'reorder' for logged OrderRecords.
    """

    __tablename__ = "stock_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    quantity_initial: Mapped[float] = mapped_column(Float)
    quantity_remaining: Mapped[float] = mapped_column(Float)
    arrival_date: Mapped[_date] = mapped_column(Date, index=True)
    expiry_date: Mapped[_date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="reorder")
    # FK to order_records.id when source='reorder'; NULL for 'initial'
    order_record_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("order_records.id"), nullable=True
    )

"""
Order lifecycle endpoints.

POST   /orders           — log "I ordered this" (creates OrderRecord)
GET    /orders           — list all orders for this business
PUT    /orders/{id}      — edit quantity/status (locked after closing hours that day)
DELETE /orders/{id}      — cancel an order (locked after closing hours that day)
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import Business, Product
from app.models.order_record import OrderRecord
from app.models.stock_batch import StockBatch
from app.schemas.order_record import OrderRecordCreate, OrderRecordRead, OrderRecordUpdate

router = APIRouter(prefix="/orders", tags=["Orders"])


def _is_locked(ordered_date: date, biz: Business) -> bool:
    """Return True when the order quantity can no longer be edited or cancelled.

    Lock rule: locked once closing_hour has passed on the day placed.
    If closing_hour is not configured, orders are never auto-locked (stay
    editable while pending so the owner can correct quantities freely).
    Note: status transitions (e.g. marking arrived) bypass this check —
    a delivery can be confirmed any time regardless of lock state.
    """
    settings = biz.settings or {}
    closing = settings.get("closing_hour")
    if closing is None:
        return False
    closing_dt = datetime(
        ordered_date.year, ordered_date.month, ordered_date.day, int(closing)
    )
    return datetime.now() >= closing_dt


def _get_or_404(db: Session, order_id: int, biz_id: int) -> OrderRecord:
    row = db.get(OrderRecord, order_id)
    if not row or row.business_id != biz_id:
        raise HTTPException(404, "Order not found")
    return row


@router.post("", response_model=OrderRecordRead, status_code=201)
def create_order(
    body: OrderRecordCreate,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Log that an order was placed. expected_arrival_date is auto-set from product lead time."""
    product = db.get(Product, body.product_id)
    if not product or product.business_id != biz.id:
        raise HTTPException(404, "Product not found")

    # Enforce one reorder per product per day — edit today's open order instead
    existing = (
        db.query(OrderRecord)
        .filter_by(business_id=biz.id, product_id=body.product_id, ordered_date=body.ordered_date)
        .filter(OrderRecord.status != "cancelled")
        .first()
    )
    if existing:
        raise HTTPException(
            409,
            f"You already have an order for {product.name} on this date (order #{existing.id}). "
            "Edit that order's quantity instead — orders lock after closing time.",
        )

    arrival = body.ordered_date + timedelta(days=product.lead_time_days)
    row = OrderRecord(
        business_id=biz.id,
        product_id=body.product_id,
        ordered_date=body.ordered_date,
        quantity=body.quantity,
        expected_arrival_date=arrival,
        status="pending",
    )
    db.add(row)
    db.flush()  # get row.id before batch creation

    # Create a stock batch for this order (arrives after lead time)
    expiry = (
        arrival + timedelta(days=product.shelf_life_days)
        if product.shelf_life_days is not None
        else None
    )
    batch = StockBatch(
        business_id=biz.id,
        product_id=body.product_id,
        quantity_initial=body.quantity,
        quantity_remaining=body.quantity,
        arrival_date=arrival,
        expiry_date=expiry,
        source="reorder",
        order_record_id=row.id,
    )
    db.add(batch)
    db.commit()
    db.refresh(row)
    return row


@router.get("", response_model=list[OrderRecordRead])
def list_orders(
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    return (
        db.query(OrderRecord)
        .filter_by(business_id=biz.id)
        .order_by(OrderRecord.ordered_date.desc())
        .all()
    )


@router.put("/{order_id}", response_model=OrderRecordRead)
def update_order(
    order_id: int,
    body: OrderRecordUpdate,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    row = _get_or_404(db, order_id, biz.id)
    changes = body.model_dump(exclude_none=True)
    # Lock only applies to quantity edits; status transitions (e.g. marking arrived)
    # are always allowed so a delivery can be confirmed any time.
    if "quantity" in changes and _is_locked(row.ordered_date, biz):
        raise HTTPException(
            422,
            "This order is locked — quantity can only be changed until closing time on the day it was placed.",
        )
    for field, value in changes.items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{order_id}", status_code=204)
def cancel_order(
    order_id: int,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Cancel a pending order (soft-delete: sets status to 'cancelled')."""
    row = _get_or_404(db, order_id, biz.id)
    if _is_locked(row.ordered_date, biz):
        raise HTTPException(422, "This order is locked — it can only be cancelled until closing time on the day it was placed.")
    row.status = "cancelled"
    db.commit()

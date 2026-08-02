"""
Sale-event endpoints: tap-to-record live sales.

POST /sale-events          — record one tap (one transaction)
GET  /sale-events/today    — today's events rolled up by hour
DELETE /sale-events/{id}   — undo a specific tap
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.engine.live_sales import local_day_utc_bounds, rollup_by_hour, utc_to_local_date, utc_to_local_hour
from app.models import Business, Product, SaleEvent
from app.schemas.sale_event import (
    HourlyBackfillRequest,
    HourlyBackfillResponse,
    HourSlot,
    ProductTap,
    RecentTap,
    SaleEventCreate,
    SaleEventRead,
    TodaySummaryResponse,
)

router = APIRouter(prefix="/sale-events", tags=["Sale Events"])


def _get_or_404(db: Session, event_id: int, biz_id: int) -> SaleEvent:
    row = db.get(SaleEvent, event_id)
    if not row or row.business_id != biz_id:
        raise HTTPException(404, "Sale event not found")
    return row


@router.post("", response_model=SaleEventRead, status_code=201)
def create_sale_event(body: SaleEventCreate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    if body.product_id is not None:
        p = db.get(Product, body.product_id)
        if not p or p.business_id != biz.id:
            raise HTTPException(404, "Product not found")
    row = SaleEvent(
        business_id=biz.id,
        product_id=body.product_id,
        timestamp=datetime.now(),
        quantity=body.quantity,
        unit_price=body.unit_price,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post("/backfill-hourly", response_model=HourlyBackfillResponse, status_code=201)
def backfill_hourly(
    body: HourlyBackfillRequest,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Record hourly customer counts for a past day from register logs.

    Replaces any existing SaleEvents for that date so re-submitting is safe.
    Creates one SaleEvent per hour slot with quantity = customers; the
    hourly-analytics engine sums quantities to get arrival-rate λ.

    ``body.date`` and each slot's hour are the business's LOCAL calendar day
    and local hour (read off a register) — they're converted to UTC before
    storage so they line up with live-tap SaleEvents, which are stored as
    true UTC.
    """
    settings = biz.settings or {}
    tz_name: str = settings.get("timezone", "UTC")
    day_start, day_end = local_day_utc_bounds(body.date, tz_name)
    db.query(SaleEvent).filter(
        SaleEvent.business_id == biz.id,
        SaleEvent.timestamp >= day_start,
        SaleEvent.timestamp < day_end,
    ).delete()

    for slot in body.hours:
        local_ts = datetime.combine(body.date, datetime.min.time(), tzinfo=ZoneInfo(tz_name)).replace(
            hour=slot.hour
        )
        utc_ts = local_ts.astimezone(timezone.utc).replace(tzinfo=None)
        db.add(SaleEvent(
            business_id=biz.id,
            product_id=None,
            timestamp=utc_ts,
            quantity=slot.customers,
        ))
    db.commit()
    return HourlyBackfillResponse(inserted=len(body.hours))


@router.get("/today", response_model=TodaySummaryResponse)
def get_today_summary(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    settings = biz.settings or {}
    tz_name: str = settings.get("timezone", "UTC")
    today = utc_to_local_date(datetime.now(timezone.utc), tz_name)
    day_start, day_end = local_day_utc_bounds(today, tz_name)

    events = (
        db.query(SaleEvent)
        .filter(
            SaleEvent.business_id == biz.id,
            SaleEvent.timestamp >= day_start,
            SaleEvent.timestamp < day_end,
        )
        .order_by(SaleEvent.timestamp)
        .all()
    )

    # Build a name-lookup for products referenced today
    pids = {e.product_id for e in events if e.product_id is not None}
    name_map: dict[int, str] = {}
    if pids:
        for p in db.query(Product).filter(Product.id.in_(pids)).all():
            name_map[p.id] = p.name

    # Pass plain tuples to the pure engine function — hour must be the LOCAL
    # hour so the end-of-day chart and hourly table match the business's
    # clock, not the UTC storage clock.
    raw = [(utc_to_local_hour(e.timestamp, tz_name), e.product_id, e.quantity) for e in events]
    rollup = rollup_by_hour(raw)

    # Build hour slots
    hours: list[HourSlot] = []
    for hour, tap_count, totals in rollup:
        product_taps = [
            ProductTap(
                product_id=pid,
                product_name=name_map.get(pid) if pid is not None else None,
                units=qty,
            )
            for pid, qty in sorted(
                totals.items(),
                key=lambda kv: (kv[0] is None, kv[0] or 0),
            )
        ]
        hours.append(HourSlot(hour=hour, taps=tap_count, product_taps=product_taps))

    # Aggregate product totals across the whole day (for button badges)
    day_totals: dict[Optional[int], float] = {}
    for _, _, totals in rollup:
        for pid, qty in totals.items():
            day_totals[pid] = day_totals.get(pid, 0.0) + qty

    product_totals = [
        ProductTap(
            product_id=pid,
            product_name=name_map.get(pid) if pid is not None else None,
            units=qty,
        )
        for pid, qty in sorted(
            day_totals.items(),
            key=lambda kv: (kv[0] is None, kv[0] or 0),
        )
    ]

    recent_taps = [
        RecentTap(
            id=e.id,
            product_name=name_map.get(e.product_id) if e.product_id is not None else None,
            quantity=e.quantity,
            timestamp=e.timestamp,
        )
        for e in reversed(events[-10:])
    ]

    return TodaySummaryResponse(
        date=today,
        total_taps=len(events),
        product_totals=product_totals,
        hours=hours,
        recent_taps=recent_taps,
        timezone=tz_name,
    )


@router.delete("/{event_id}", status_code=204)
def delete_sale_event(event_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, event_id, biz.id)
    db.delete(row)
    db.commit()

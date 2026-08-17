"""
Sale-event endpoints: tap-to-record live sales.

POST /sale-events          — record one tap (one transaction)
GET  /sale-events/today    — today's events rolled up by hour
DELETE /sale-events/{id}   — undo a specific tap
"""
from __future__ import annotations

from datetime import date as date_type, datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import clock
from app.api.deps import get_business
from app.db import get_db
from app.engine.live_sales import local_day_utc_bounds, rollup_by_hour, utc_to_local_date, utc_to_local_hour
from app.models import Business, Product, SaleEvent
from app.schemas.sale_event import (
    BackfillPreviewProduct,
    BackfillPreviewResponse,
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
        timestamp=clock.now_naive_utc(),
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
    """Record hourly customer counts — and optionally per-product totals — for a day.

    **Only replaces the kind of data the submission actually provides.**  This
    used to delete every SaleEvent in the day's window before writing, so an
    owner who tapped products during service and later tidied up their hourly
    customer counts from the register silently lost the entire product
    breakdown for that day — no warning, nothing in the response to say so.

    * Hourly customer counts are always replaced; that is what makes
      re-submitting a corrected day safe and idempotent.
    * Product rows are replaced **only when ``body.products`` is supplied**
      (a register export, or a CSV with product columns), which keeps
      re-importing the same file idempotent. A customers-only submission
      leaves them completely untouched.

    ``body.date`` and each slot's hour are the business's LOCAL calendar day
    and local hour (read off a register) — they're converted to UTC before
    storage so they line up with live-tap SaleEvents, which are stored as
    true UTC.
    """
    settings = biz.settings or {}
    tz_name: str = settings.get("timezone", "UTC")
    day_start, day_end = local_day_utc_bounds(body.date, tz_name)

    in_day = (
        SaleEvent.business_id == biz.id,
        SaleEvent.timestamp >= day_start,
        SaleEvent.timestamp < day_end,
    )

    # Always replace the customer-count aggregate — that is what was submitted.
    replaced_hours = (
        db.query(SaleEvent)
        .filter(*in_day, SaleEvent.product_id.is_(None))
        .delete(synchronize_session=False)
    )

    product_rows = db.query(SaleEvent).filter(*in_day, SaleEvent.product_id.isnot(None))
    if body.products is None:
        replaced_products = 0
        kept_products = product_rows.count()      # left exactly as they were
    else:
        kept_products = 0
        replaced_products = product_rows.delete(synchronize_session=False)

    def _utc_at(hour: int) -> datetime:
        local_ts = datetime.combine(
            body.date, datetime.min.time(), tzinfo=ZoneInfo(tz_name)
        ).replace(hour=hour)
        return local_ts.astimezone(timezone.utc).replace(tzinfo=None)

    for slot in body.hours:
        db.add(SaleEvent(
            business_id=biz.id,
            product_id=None,
            timestamp=_utc_at(slot.hour),
            quantity=slot.customers,
        ))

    if body.products:
        # Park product totals at the busiest submitted hour so they sit inside
        # the day's opening hours and are never filtered out as closed-hour data.
        busiest = max(body.hours, key=lambda s: s.customers).hour
        at = _utc_at(busiest)
        for pu in body.products:
            prod = db.get(Product, pu.product_id)
            if not prod or prod.business_id != biz.id:
                raise HTTPException(404, f"Product {pu.product_id} not found")
            if pu.units > 0:
                db.add(SaleEvent(
                    business_id=biz.id,
                    product_id=pu.product_id,
                    timestamp=at,
                    quantity=pu.units,
                ))

    db.commit()
    return HourlyBackfillResponse(
        inserted=len(body.hours),
        replaced_hours=replaced_hours,
        replaced_products=replaced_products,
        kept_products=kept_products,
    )


@router.get("/backfill-preview", response_model=BackfillPreviewResponse)
def backfill_preview(
    day: date_type,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """What is already stored for a date, so the owner can be shown what a
    submission will replace and what it will leave alone — before they save."""
    settings = biz.settings or {}
    tz_name: str = settings.get("timezone", "UTC")
    day_start, day_end = local_day_utc_bounds(day, tz_name)
    rows = (
        db.query(SaleEvent)
        .filter(
            SaleEvent.business_id == biz.id,
            SaleEvent.timestamp >= day_start,
            SaleEvent.timestamp < day_end,
        )
        .all()
    )
    hours = [r for r in rows if r.product_id is None]
    prod_rows = [r for r in rows if r.product_id is not None]

    totals: dict[int, float] = {}
    for r in prod_rows:
        totals[r.product_id] = totals.get(r.product_id, 0.0) + float(r.quantity)
    names: dict[int, str] = {}
    if totals:
        for p in db.query(Product).filter(Product.id.in_(totals.keys())).all():
            names[p.id] = p.name

    return BackfillPreviewResponse(
        date=day,
        existing_hours=len(hours),
        existing_hour_customers=sum(float(r.quantity) for r in hours),
        existing_products=[
            BackfillPreviewProduct(
                product_id=pid, product_name=names.get(pid, f"#{pid}"), units=round(u, 3)
            )
            for pid, u in sorted(totals.items(), key=lambda kv: -kv[1])
        ],
    )


@router.get("/today", response_model=TodaySummaryResponse)
def get_today_summary(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    settings = biz.settings or {}
    tz_name: str = settings.get("timezone", "UTC")
    today = clock.today_local(settings)
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

from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.engine.limits import check_entry_timing, check_history, check_non_working_day, history_cutoff
from app.engine.live_sales import (
    compute_open_hours,
    local_day_utc_bounds,
    reconcile_customers_with_hours,
    utc_to_local_date,
    utc_to_local_hour,
)
from app.engine.outliers import detect_outliers
from app.models import Business, DayRecord, Period, RecurringPattern, SaleEvent
from app.schemas.day_record import (
    DayRecordCreate,
    DayRecordRead,
    DayRecordUpdate,
    OutlierResolveRequest,
)

router = APIRouter(prefix="/day-records", tags=["Day Records"])


def rollup_tap_days(db: Session, biz: Business) -> list[date]:
    """Create DayRecords for past dates that have SaleEvents but no DayRecord.

    Implements the spec §9 requirement that tap-only days roll into past-days
    automatically after closing hours.  Customer count = sum of customer-tap
    (product_id=None) SaleEvent quantities within open hours.  Falls back to
    the total open-hours event count when no customer taps exist.

    Safe to call repeatedly — skips dates that already have a DayRecord.
    Returns the list of dates for which new records were created.
    """
    settings = biz.settings or {}
    open_hours = compute_open_hours(settings)
    tz_name: str = settings.get("timezone", "UTC")
    today = utc_to_local_date(datetime.now(timezone.utc), tz_name)

    # All SaleEvents for this business, grouped by LOCAL calendar date (not
    # the UTC date the raw timestamp happens to fall on — a sale a few hours
    # before UTC midnight can be the business's next local day, or vice versa).
    all_events = db.query(SaleEvent).filter(SaleEvent.business_id == biz.id).all()
    if not all_events:
        return []

    past_dates = {
        d for d in (utc_to_local_date(e.timestamp, tz_name) for e in all_events)
        if d < today
    }
    if not past_dates:
        return []

    # Existing DayRecord dates — skip these
    existing: set[date] = {
        r[0] for r in db.query(DayRecord.date).filter(DayRecord.business_id == biz.id).all()
    }

    created: list[date] = []
    for event_date in sorted(past_dates):
        if event_date in existing:
            continue

        day_start, day_end = local_day_utc_bounds(event_date, tz_name)

        # Sum customer-arrival taps (product_id=None) within open hours
        cust_events = (
            db.query(SaleEvent)
            .filter(
                SaleEvent.business_id == biz.id,
                SaleEvent.product_id.is_(None),
                SaleEvent.timestamp >= day_start,
                SaleEvent.timestamp < day_end,
            )
            .all()
        )
        customers = round(sum(
            float(e.quantity) for e in cust_events
            if utc_to_local_hour(e.timestamp, tz_name) in open_hours
        ))

        # Fall back to total open-hours event count when no customer taps
        if customers == 0:
            all_day_events = (
                db.query(SaleEvent)
                .filter(
                    SaleEvent.business_id == biz.id,
                    SaleEvent.timestamp >= day_start,
                    SaleEvent.timestamp < day_end,
                )
                .all()
            )
            customers = sum(
                1 for e in all_day_events
                if utc_to_local_hour(e.timestamp, tz_name) in open_hours
            )

        if customers == 0:
            continue

        try:
            db.add(DayRecord(business_id=biz.id, date=event_date, customers=customers))
            db.commit()
            existing.add(event_date)
            created.append(event_date)
        except IntegrityError:
            db.rollback()  # another request created it concurrently — harmless

    return created

_MIN_FOR_DETECTION = 14  # mirror analytics.MIN_RECORDS
_WD_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _timing_check(record_date: date, biz: Business) -> None:
    """Raise HTTPException 422 if entry-timing rules block this date."""
    settings = biz.settings or {}
    tz_name: str = settings.get("timezone", "UTC")
    raw_open = settings.get("opening_hour")
    raw_close = settings.get("closing_hour")
    opening = int(raw_open) if raw_open is not None else None
    closing = int(raw_close) if raw_close is not None else None
    opening_days = settings.get("opening_days")
    try:
        check_non_working_day(record_date, date.today(), opening_days)
        check_entry_timing(record_date, date.today(), utc_to_local_hour(datetime.now(), tz_name), opening, closing)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _hourly_consistency_warning(
    db: Session, biz: Business, record_date: date, customers: int
) -> str | None:
    """Return a non-blocking warning when known hourly SaleEvent data exceeds the daily total.

    SaleEvents with product_id=None represent explicit 'customer arrived' taps;
    SaleEvents from backfill-hourly also store per-hour quantities with product_id=None.
    Their sum is the 'known hourly total' for the day.

    Partial coverage is fine (known hours < total — the gap is 'unknown time').
    Only flag when sum of known hours > customers, since that is mathematically
    inconsistent with the daily total being the source of truth.
    """
    tz_name: str = (biz.settings or {}).get("timezone", "UTC")
    day_start, day_end = local_day_utc_bounds(record_date, tz_name)

    hourly_total = (
        db.query(SaleEvent)
        .filter(
            SaleEvent.business_id == biz.id,
            SaleEvent.product_id.is_(None),
            SaleEvent.timestamp >= day_start,
            SaleEvent.timestamp < day_end,
        )
        .with_entities(SaleEvent.quantity)
        .all()
    )
    total_known = sum(float(r.quantity) for r in hourly_total)

    if total_known > customers:
        return (
            f"Heads up: the hourly data for this day adds up to {int(total_known)} customers, "
            f"but you've entered {customers}. The daily total you entered is the source of truth. "
            f"If {int(total_known)} is right, update the customers count to match — "
            f"or choose 'rely on daily total only' and the extra hourly detail will be kept as-is."
        )
    return None


def _apply_reconciliation(db: Session, biz: Business, record_date: date, manual_total: int | None) -> int:
    """Query open-hours customer-tap SaleEvents for the date and apply reconciliation.

    Implements spec §9: hours sum > manual total → hours win; no manual total →
    use hours sum; hours sum ≤ total → keep manual total.  Only open-hours events
    count so closed-hour taps (if any) never inflate the total.
    """
    settings = biz.settings or {}
    open_hours = compute_open_hours(settings)
    tz_name: str = settings.get("timezone", "UTC")
    day_start, day_end = local_day_utc_bounds(record_date, tz_name)

    events = (
        db.query(SaleEvent)
        .filter(
            SaleEvent.business_id == biz.id,
            SaleEvent.product_id.is_(None),  # customer-arrival taps only
            SaleEvent.timestamp >= day_start,
            SaleEvent.timestamp < day_end,
        )
        .all()
    )
    hours_sum = sum(
        float(e.quantity) for e in events
        if utc_to_local_hour(e.timestamp, tz_name) in open_hours
    )
    effective, _ = reconcile_customers_with_hours(manual_total, hours_sum)
    return effective


def _get_or_404(db: Session, record_id: int, biz_id: int) -> DayRecord:
    row = db.get(DayRecord, record_id)
    if not row or row.business_id != biz_id:
        raise HTTPException(404, "Day record not found")
    return row


def _auto_flag_outliers(db: Session, business_id: int) -> None:
    """Detect outliers and persist 'flagged' status.

    Uses only the clean detection set — event-period dates and closed-day
    weekdays are excluded from both the reference set and the candidates.
    This prevents event spikes from contaminating the normal-day baseline.
    """
    # Load periods to build blocked-dates set
    periods = db.query(Period).filter_by(business_id=business_id).all()
    blocked: set[date] = set()
    for p in periods:
        d = p.start_date
        while d <= p.end_date:
            blocked.add(d)
            d += timedelta(days=1)

    biz = db.get(Business, business_id)
    open_days: set[int] | None = None
    if biz and biz.settings:
        od = biz.settings.get("opening_days")
        if od is not None:
            open_days = set(int(x) for x in od)

    all_records = (
        db.query(DayRecord)
        .filter_by(business_id=business_id)
        .order_by(DayRecord.date)
        .all()
    )

    # Detection set: exclude event/ad periods, closed days, already-resolved records
    det_records = [
        r for r in all_records
        if r.date not in blocked
        and (open_days is None or r.date.weekday() in open_days)
        and r.outlier_status not in ("excluded", "event", "kept")
    ]

    if len(det_records) < _MIN_FOR_DETECTION:
        return

    obs = [float(r.customers) for r in det_records]
    wds = [r.date.weekday() for r in det_records]
    detected = {d.day_index for d in detect_outliers(obs, wds)}

    changed = False
    for i, r in enumerate(det_records):
        if r.outlier_status is None and i in detected:
            r.outlier_status = "flagged"
            changed = True
    if changed:
        db.commit()


@router.post("/rollup-tap-days", status_code=200)
def rollup_tap_days_endpoint(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    """Create DayRecords for any past tap-only days that don't yet have one.

    Backfills the customer count from SaleEvent data for each missing date.
    Safe to call multiple times — already-existing records are left untouched.
    Also triggers outlier detection so any newly created records are flagged
    immediately rather than waiting for the next LogScreen load.
    """
    created = rollup_tap_days(db, biz)
    if created:
        _auto_flag_outliers(db, biz.id)
    return {"created_dates": [str(d) for d in created], "count": len(created)}


@router.get("", response_model=list[DayRecordRead])
def list_day_records(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    query = db.query(DayRecord).filter_by(business_id=biz.id)
    cutoff = history_cutoff(biz.tier, date.today())
    if cutoff is not None:
        query = query.filter(DayRecord.date >= cutoff)
    return query.order_by(DayRecord.date).all()


@router.post("", response_model=DayRecordRead, status_code=201)
def create_day_record(body: DayRecordCreate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    try:
        check_history(biz.tier, body.date, date.today())
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    _timing_check(body.date, biz)
    # Reject duplicates before hitting the unique constraint so the error is a
    # clean 409 rather than an unhandled IntegrityError that looks like CORS.
    if db.query(DayRecord).filter_by(business_id=biz.id, date=body.date).first():
        raise HTTPException(status_code=409, detail="A record for this date already exists.")
    data = body.model_dump()
    # Apply hours-vs-total reconciliation: if open-hours SaleEvent sum is
    # larger than the entered total, the more granular hourly data wins.
    reconciled_customers = _apply_reconciliation(db, biz, body.date, body.customers)
    data["customers"] = reconciled_customers
    row = DayRecord(business_id=biz.id, **data)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A record for this date already exists.")
    db.refresh(row)
    _auto_flag_outliers(db, biz.id)
    db.refresh(row)
    # Non-blocking data-consistency check: warn only if hourly data STILL exceeds
    # the reconciled total (after reconciliation this should be rare)
    warning = _hourly_consistency_warning(db, biz, body.date, reconciled_customers)
    result = DayRecordRead.model_validate(row)
    result.warning = warning
    return result


@router.get("/{record_id}", response_model=DayRecordRead)
def get_day_record(record_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return _get_or_404(db, record_id, biz.id)


@router.put("/{record_id}", response_model=DayRecordRead)
def update_day_record(record_id: int, body: DayRecordUpdate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, record_id, biz.id)
    _timing_check(row.date, biz)
    # Save current values as the previous version before overwriting (one-step undo)
    row.prev_customers = row.customers
    row.prev_notes = row.notes
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    # Apply hours-vs-total reconciliation after updating the customers field
    reconciled = _apply_reconciliation(db, biz, row.date, row.customers)
    if reconciled != row.customers:
        row.customers = reconciled
    db.commit()
    db.refresh(row)
    # Non-blocking data-consistency check
    new_customers = body.customers if body.customers is not None else row.customers
    warning = _hourly_consistency_warning(db, biz, row.date, new_customers)
    result = DayRecordRead.model_validate(row)
    result.warning = warning
    return result


@router.post("/{record_id}/undo", response_model=DayRecordRead)
def undo_day_record(record_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    """Restore the immediately-previous version of a day record (one step back).

    Swaps current ↔ prev so a second call re-applies the overwrite (undo-of-undo).
    Raises 404 when no previous version exists.
    """
    row = _get_or_404(db, record_id, biz.id)
    if row.prev_customers is None:
        raise HTTPException(404, "No previous version to restore for this record.")
    # Swap current ↔ prev
    cur_customers, cur_notes = row.customers, row.notes
    row.customers = row.prev_customers
    row.notes = row.prev_notes
    row.prev_customers = cur_customers
    row.prev_notes = cur_notes
    db.commit()
    db.refresh(row)
    return DayRecordRead.model_validate(row)


@router.patch("/{record_id}/outlier", response_model=DayRecordRead)
def resolve_outlier(
    record_id: int,
    body: OutlierResolveRequest,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Resolve a flagged outlier: keep, exclude as fluke, mark as event, or mark as recurring."""
    row = _get_or_404(db, record_id, biz.id)

    if body.action == "unflag":
        # Restore this day to normal — it becomes unreviewed and can be re-detected
        row.outlier_status = None
    elif body.action == "recurring":
        wd = row.date.weekday()
        wd_name = _WD_NAMES[wd]
        # Create a RecurringPattern for this weekday if one doesn't already cover it
        existing = db.query(RecurringPattern).filter_by(business_id=biz.id).all()
        already_covered = any(wd in (p.weekdays or []) for p in existing)
        if not already_covered:
            db.add(RecurringPattern(
                business_id=biz.id,
                label=f"Regular {wd_name} bump",
                weekdays=[wd],
                effect="higher",
            ))
        row.outlier_status = "kept"
    elif body.action == "ad":
        # Exclude from normal baseline (same as event) and create an ad Period for lift tracking
        existing_period = db.query(Period).filter_by(
            business_id=biz.id, type="ad", start_date=row.date, end_date=row.date
        ).first()
        if not existing_period:
            db.add(Period(
                business_id=biz.id,
                start_date=row.date,
                end_date=row.date,
                type="ad",
                label=f"Ad – {row.date}",
            ))
        row.outlier_status = "event"
    else:
        row.outlier_status = body.action

    db.commit()
    db.refresh(row)
    return row


@router.delete("/{record_id}", status_code=204)
def delete_day_record(record_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, record_id, biz.id)
    db.delete(row)
    db.commit()

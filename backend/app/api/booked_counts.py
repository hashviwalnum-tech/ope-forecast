from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import BookedCount, Business, ServiceBookedCount
from app.schemas.booked_count import BookedCountRead, BookedCountUpsert

router = APIRouter(prefix="/booked-counts", tags=["Booked Counts"])


def _to_read(row: BookedCount | ServiceBookedCount, product_id: int | None) -> BookedCountRead:
    return BookedCountRead(date=row.date, booked_count=row.booked_count, product_id=product_id)


@router.get("", response_model=list[BookedCountRead])
def list_booked_counts(
    product_id: int | None = Query(None, description="Filter to one service; omit for the whole-business total"),
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    if product_id is not None:
        rows = (
            db.query(ServiceBookedCount)
            .filter_by(business_id=biz.id, product_id=product_id)
            .order_by(ServiceBookedCount.date)
            .all()
        )
        return [_to_read(r, product_id) for r in rows]
    rows = db.query(BookedCount).filter_by(business_id=biz.id).order_by(BookedCount.date).all()
    return [_to_read(r, None) for r in rows]


@router.put("/{record_date}", response_model=BookedCountRead)
def upsert_booked_count(
    record_date: date,
    body: BookedCountUpsert,
    product_id: int | None = Query(None, description="Set to upsert a specific service's booked count"),
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Create or update the booked-appointment count for a date.

    Freely editable any time — this is the owner's running booking estimate,
    not a locked daily total, so none of the day-record entry-timing rules apply.
    Pass ?product_id=N to record a specific service's count instead of the
    whole-business total.
    """
    if product_id is not None:
        row = (
            db.query(ServiceBookedCount)
            .filter_by(business_id=biz.id, product_id=product_id, date=record_date)
            .first()
        )
        if row:
            row.booked_count = body.booked_count
        else:
            row = ServiceBookedCount(
                business_id=biz.id, product_id=product_id, date=record_date, booked_count=body.booked_count
            )
            db.add(row)
        db.commit()
        db.refresh(row)
        return _to_read(row, product_id)

    row = db.query(BookedCount).filter_by(business_id=biz.id, date=record_date).first()
    if row:
        row.booked_count = body.booked_count
    else:
        row = BookedCount(business_id=biz.id, date=record_date, booked_count=body.booked_count)
        db.add(row)
    db.commit()
    db.refresh(row)
    return _to_read(row, None)


@router.delete("/{record_date}", status_code=204)
def delete_booked_count(
    record_date: date,
    product_id: int | None = Query(None),
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    if product_id is not None:
        db.query(ServiceBookedCount).filter_by(
            business_id=biz.id, product_id=product_id, date=record_date
        ).delete()
    else:
        db.query(BookedCount).filter_by(business_id=biz.id, date=record_date).delete()
    db.commit()

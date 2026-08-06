from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import BookedCount, Business
from app.schemas.booked_count import BookedCountRead, BookedCountUpsert

router = APIRouter(prefix="/booked-counts", tags=["Booked Counts"])


@router.get("", response_model=list[BookedCountRead])
def list_booked_counts(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return (
        db.query(BookedCount)
        .filter_by(business_id=biz.id)
        .order_by(BookedCount.date)
        .all()
    )


@router.put("/{record_date}", response_model=BookedCountRead)
def upsert_booked_count(
    record_date: date,
    body: BookedCountUpsert,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Create or update the booked-appointment count for a date.

    Freely editable any time — this is the owner's running booking estimate,
    not a locked daily total, so none of the day-record entry-timing rules apply.
    """
    row = db.query(BookedCount).filter_by(business_id=biz.id, date=record_date).first()
    if row:
        row.booked_count = body.booked_count
    else:
        row = BookedCount(business_id=biz.id, date=record_date, booked_count=body.booked_count)
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{record_date}", status_code=204)
def delete_booked_count(
    record_date: date,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    db.query(BookedCount).filter_by(business_id=biz.id, date=record_date).delete()
    db.commit()

from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.engine.limits import check_history, history_cutoff
from app.engine.outliers import detect_outliers
from app.models import Business, DayRecord
from app.schemas.day_record import (
    DayRecordCreate,
    DayRecordRead,
    DayRecordUpdate,
    OutlierResolveRequest,
)

router = APIRouter(prefix="/day-records", tags=["Day Records"])

_MIN_FOR_DETECTION = 14  # mirror analytics.MIN_RECORDS


def _get_or_404(db: Session, record_id: int, biz_id: int) -> DayRecord:
    row = db.get(DayRecord, record_id)
    if not row or row.business_id != biz_id:
        raise HTTPException(404, "Day record not found")
    return row


def _auto_flag_outliers(db: Session, business_id: int) -> None:
    """Detect outliers on all unreviewed records and persist 'flagged' status."""
    records = (
        db.query(DayRecord)
        .filter_by(business_id=business_id)
        .order_by(DayRecord.date)
        .all()
    )
    if len(records) < _MIN_FOR_DETECTION:
        return

    obs = [float(r.customers) for r in records]
    wds = [r.date.weekday() for r in records]
    detected = {d.day_index for d in detect_outliers(obs, wds)}

    changed = False
    for i, r in enumerate(records):
        if r.outlier_status is None and i in detected:
            r.outlier_status = "flagged"
            changed = True
    if changed:
        db.commit()


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
    row = DayRecord(business_id=biz.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    _auto_flag_outliers(db, biz.id)
    db.refresh(row)
    return row


@router.get("/{record_id}", response_model=DayRecordRead)
def get_day_record(record_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return _get_or_404(db, record_id, biz.id)


@router.put("/{record_id}", response_model=DayRecordRead)
def update_day_record(record_id: int, body: DayRecordUpdate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, record_id, biz.id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{record_id}/outlier", response_model=DayRecordRead)
def resolve_outlier(record_id: int, body: OutlierResolveRequest, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    """Resolve a flagged outlier: keep it, exclude it as a fluke, or mark it as an event."""
    row = _get_or_404(db, record_id, biz.id)
    row.outlier_status = body.action
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{record_id}", status_code=204)
def delete_day_record(record_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, record_id, biz.id)
    db.delete(row)
    db.commit()

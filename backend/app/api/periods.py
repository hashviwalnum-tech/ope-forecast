from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.engine.limits import check_periods
from app.models import Business, Period
from app.schemas.period import PeriodCreate, PeriodRead, PeriodUpdate

router = APIRouter(prefix="/periods", tags=["Periods"])


def _get_or_404(db: Session, period_id: int, biz_id: int) -> Period:
    row = db.get(Period, period_id)
    if not row or row.business_id != biz_id:
        raise HTTPException(404, "Period not found")
    return row


@router.get("", response_model=list[PeriodRead])
def list_periods(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return db.query(Period).filter_by(business_id=biz.id).order_by(Period.start_date).all()


@router.post("", response_model=PeriodRead, status_code=201)
def create_period(body: PeriodCreate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    count = db.query(Period).filter_by(business_id=biz.id, type=body.type).count()
    try:
        check_periods(biz.tier, count, body.type)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    row = Period(business_id=biz.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{period_id}", response_model=PeriodRead)
def get_period(period_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return _get_or_404(db, period_id, biz.id)


@router.put("/{period_id}", response_model=PeriodRead)
def update_period(period_id: int, body: PeriodUpdate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, period_id, biz.id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{period_id}", status_code=204)
def delete_period(period_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, period_id, biz.id)
    db.delete(row)
    db.commit()

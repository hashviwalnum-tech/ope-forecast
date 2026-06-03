from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import Business, RecurringPattern
from app.schemas.recurring_pattern import (
    RecurringPatternCreate,
    RecurringPatternRead,
    RecurringPatternUpdate,
)

router = APIRouter(prefix="/recurring-patterns", tags=["RecurringPatterns"])


def _get_or_404(db: Session, pat_id: int, biz_id: int) -> RecurringPattern:
    row = db.get(RecurringPattern, pat_id)
    if not row or row.business_id != biz_id:
        raise HTTPException(404, "Recurring pattern not found")
    return row


@router.get("", response_model=list[RecurringPatternRead])
def list_patterns(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return db.query(RecurringPattern).filter_by(business_id=biz.id).all()


@router.post("", response_model=RecurringPatternRead, status_code=201)
def create_pattern(
    body: RecurringPatternCreate,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    row = RecurringPattern(business_id=biz.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{pat_id}", response_model=RecurringPatternRead)
def get_pattern(pat_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return _get_or_404(db, pat_id, biz.id)


@router.put("/{pat_id}", response_model=RecurringPatternRead)
def update_pattern(
    pat_id: int,
    body: RecurringPatternUpdate,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    row = _get_or_404(db, pat_id, biz.id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{pat_id}", status_code=204)
def delete_pattern(
    pat_id: int,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    row = _get_or_404(db, pat_id, biz.id)
    db.delete(row)
    db.commit()

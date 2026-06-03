from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import Business, Regular
from app.schemas.regular import RegularCreate, RegularRead, RegularUpdate

router = APIRouter(prefix="/regulars", tags=["Regulars"])


def _clv(r: Regular) -> float:
    return round(r.visit_frequency_per_week * 52.0 * r.avg_spend * r.expected_lifespan_years, 2)


def _to_read(r: Regular) -> RegularRead:
    return RegularRead(
        id=r.id,
        business_id=r.business_id,
        name=r.name,
        visit_frequency_per_week=r.visit_frequency_per_week,
        avg_spend=r.avg_spend,
        expected_lifespan_years=r.expected_lifespan_years,
        notes=r.notes,
        visit_count=r.visit_count or 0,
        first_visit_date=r.first_visit_date,
        last_visit_date=r.last_visit_date,
        clv=_clv(r),
    )


def _get_or_404(db: Session, reg_id: int, biz_id: int) -> Regular:
    row = db.get(Regular, reg_id)
    if not row or row.business_id != biz_id:
        raise HTTPException(404, "Regular not found")
    return row


@router.get("", response_model=list[RegularRead])
def list_regulars(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    rows = db.query(Regular).filter_by(business_id=biz.id).order_by(Regular.name).all()
    return [_to_read(r) for r in rows]


@router.post("", response_model=RegularRead, status_code=201)
def create_regular(
    body: RegularCreate,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    row = Regular(business_id=biz.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_read(row)


@router.get("/{reg_id}", response_model=RegularRead)
def get_regular(reg_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return _to_read(_get_or_404(db, reg_id, biz.id))


@router.put("/{reg_id}", response_model=RegularRead)
def update_regular(
    reg_id: int,
    body: RegularUpdate,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    row = _get_or_404(db, reg_id, biz.id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return _to_read(row)


@router.delete("/{reg_id}", status_code=204)
def delete_regular(reg_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, reg_id, biz.id)
    db.delete(row)
    db.commit()


@router.post("/{reg_id}/visit", response_model=RegularRead)
def record_visit(reg_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    """Log a visit from this regular. Increments visit_count, tracks first/last date."""
    row = _get_or_404(db, reg_id, biz.id)
    today = date.today()
    if row.first_visit_date is None:
        row.first_visit_date = today
    row.last_visit_date = today
    row.visit_count = (row.visit_count or 0) + 1
    db.commit()
    db.refresh(row)
    return _to_read(row)

from datetime import date
from calendar import monthrange

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import Business, Regular
from app.models.regular_daily_spend import RegularDailySpend
from app.schemas.regular import (
    MonthlyVisits,
    RegularCreate, RegularProfitabilityRead, RegularRead, RegularUpdate, RegularVisitBody,
)

router = APIRouter(prefix="/regulars", tags=["Regulars"])


def _clv(r: Regular) -> float:
    return round(r.visit_frequency_per_week * 52.0 * r.avg_spend * r.expected_lifespan_years, 2)


def _today_amount(db: Session, regular_id: int) -> float | None:
    row = (
        db.query(RegularDailySpend)
        .filter_by(regular_id=regular_id, date=date.today())
        .first()
    )
    return row.amount if row else None


def _to_read(r: Regular, db: Session) -> RegularRead:
    # Derive visit_count from actual spend records so the displayed count
    # stays accurate even if the stored counter drifted (e.g. from early
    # testing before the same-day uniqueness constraint was enforced).
    actual_count = db.query(RegularDailySpend).filter_by(regular_id=r.id).count()
    return RegularRead(
        id=r.id,
        business_id=r.business_id,
        name=r.name,
        visit_frequency_per_week=r.visit_frequency_per_week,
        avg_spend=r.avg_spend,
        expected_lifespan_years=r.expected_lifespan_years,
        notes=r.notes,
        is_favorite=getattr(r, "is_favorite", False) or False,
        visit_count=actual_count,
        first_visit_date=r.first_visit_date,
        last_visit_date=r.last_visit_date,
        clv=_clv(r),
        today_amount=_today_amount(db, r.id),
    )


def _get_or_404(db: Session, reg_id: int, biz_id: int) -> Regular:
    row = db.get(Regular, reg_id)
    if not row or row.business_id != biz_id:
        raise HTTPException(404, "Regular not found")
    return row


@router.get("", response_model=list[RegularRead])
def list_regulars(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    rows = db.query(Regular).filter_by(business_id=biz.id).order_by(Regular.name).all()
    return [_to_read(r, db) for r in rows]


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
    return _to_read(row, db)


@router.get("/{reg_id}", response_model=RegularRead)
def get_regular(reg_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return _to_read(_get_or_404(db, reg_id, biz.id), db)


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
    return _to_read(row, db)


@router.delete("/{reg_id}", status_code=204)
def delete_regular(reg_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, reg_id, biz.id)
    db.delete(row)
    db.commit()


@router.post("/{reg_id}/visit", response_model=RegularRead)
def record_visit(
    reg_id: int,
    body: RegularVisitBody = RegularVisitBody(),
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Log or update today's visit for this regular.

    ONE record per regular per day (RegularDailySpend). Calling this again
    today replaces the day's total — no duplicate-visit blocking.
    visit_count increments only when first recording this day.
    """
    row = _get_or_404(db, reg_id, biz.id)
    today = date.today()

    amount = body.amount_paid if body.amount_paid is not None else row.avg_spend

    existing = (
        db.query(RegularDailySpend)
        .filter_by(regular_id=reg_id, date=today)
        .first()
    )
    if existing:
        existing.amount = amount
    else:
        db.add(RegularDailySpend(regular_id=reg_id, date=today, amount=amount))
        if row.first_visit_date is None:
            row.first_visit_date = today
        row.last_visit_date = today

    db.commit()
    db.refresh(row)
    # Sync stored visit_count to actual records so it never drifts
    actual_count = db.query(RegularDailySpend).filter_by(regular_id=reg_id).count()
    if row.visit_count != actual_count:
        row.visit_count = actual_count
        db.commit()
    return _to_read(row, db)


@router.get("/{reg_id}/profitability", response_model=RegularProfitabilityRead)
def get_profitability(
    reg_id: int,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Return how much this regular has earned the business this month, this year, and all time."""
    row = _get_or_404(db, reg_id, biz.id)
    today = date.today()

    spends = db.query(RegularDailySpend).filter_by(regular_id=reg_id).all()

    this_month = sum(
        s.amount for s in spends
        if s.date.year == today.year and s.date.month == today.month
    )
    this_year = sum(s.amount for s in spends if s.date.year == today.year)
    all_time = sum(s.amount for s in spends)

    # Build last 12 months (including current month), newest last
    def _prev_months_seq(n: int) -> list[tuple[int, int]]:
        y, m = today.year, today.month
        months: list[tuple[int, int]] = []
        for _ in range(n):
            months.append((y, m))
            m -= 1
            if m == 0:
                m = 12
                y -= 1
        return list(reversed(months))

    monthly_visits: list[MonthlyVisits] = []
    for y, m in _prev_months_seq(12):
        month_spends = [s for s in spends if s.date.year == y and s.date.month == m]
        monthly_visits.append(MonthlyVisits(
            year=y,
            month=m,
            visits=len(month_spends),
            total_spend=round(sum(s.amount for s in month_spends), 2),
        ))

    return RegularProfitabilityRead(
        regular_id=reg_id,
        name=row.name,
        first_visit_date=row.first_visit_date,
        this_month=round(this_month, 2),
        this_year=round(this_year, 2),
        all_time=round(all_time, 2),
        monthly_visits=monthly_visits,
    )

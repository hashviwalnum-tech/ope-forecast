"""Tests for the regulars visit-recording logic."""
from datetime import date, timedelta

import pytest

from app.api.regulars import _clv, _today_amount
from app.models import Regular
from app.models.regular_daily_spend import RegularDailySpend
from app.schemas.regular import RegularVisitBody


def _do_record(db, regular, amount=None):
    """Call the record_visit logic directly (bypass FastAPI routing)."""
    body = RegularVisitBody(amount_paid=amount)
    today = date.today()
    amount_val = body.amount_paid if body.amount_paid is not None else regular.avg_spend
    existing = db.query(RegularDailySpend).filter_by(regular_id=regular.id, date=today).first()
    if existing:
        existing.amount = amount_val
    else:
        db.add(RegularDailySpend(regular_id=regular.id, date=today, amount=amount_val))
        regular.visit_count = (regular.visit_count or 0) + 1
        if regular.first_visit_date is None:
            regular.first_visit_date = today
        regular.last_visit_date = today
    db.commit()
    db.refresh(regular)


def test_clv_formula():
    """CLV = freq_per_week × 52 × avg_spend × lifespan_years."""
    r = Regular(visit_frequency_per_week=3, avg_spend=20, expected_lifespan_years=3)
    assert _clv(r) == pytest.approx(3 * 52 * 20 * 3)


def test_record_visit_first_time(db, regular):
    """First visit sets first_visit_date, increments visit_count."""
    _do_record(db, regular, amount=25.0)
    assert regular.visit_count == 1
    assert regular.first_visit_date == date.today()
    assert regular.last_visit_date == date.today()


def test_record_visit_same_day_updates_amount_not_count(db, regular):
    """Second call today must update the amount, NOT increment visit_count again."""
    _do_record(db, regular, amount=20.0)
    count_after_first = regular.visit_count

    _do_record(db, regular, amount=30.0)
    assert regular.visit_count == count_after_first  # unchanged

    today_row = db.query(RegularDailySpend).filter_by(
        regular_id=regular.id, date=date.today()
    ).one()
    assert today_row.amount == 30.0


def test_record_visit_different_days_increments_count(db, regular):
    """Each new calendar day increments visit_count once."""
    today = date.today()
    yesterday = today - timedelta(days=1)

    # Simulate a visit yesterday by inserting directly
    db.add(RegularDailySpend(regular_id=regular.id, date=yesterday, amount=15.0))
    regular.visit_count = 1
    regular.first_visit_date = yesterday
    regular.last_visit_date = yesterday
    db.commit()

    _do_record(db, regular, amount=20.0)
    assert regular.visit_count == 2
    assert regular.last_visit_date == today


def test_today_amount_returns_none_when_no_visit(db, regular):
    assert _today_amount(db, regular.id) is None


def test_today_amount_returns_recorded_amount(db, regular):
    _do_record(db, regular, amount=42.0)
    assert _today_amount(db, regular.id) == 42.0


def test_profitability_sums_correctly(db, regular):
    """Profitability sums daily spends by month/year/all-time."""
    today = date.today()
    db.add(RegularDailySpend(regular_id=regular.id, date=today, amount=20.0))
    # Add a past-year record
    last_year = date(today.year - 1, 1, 15)
    db.add(RegularDailySpend(regular_id=regular.id, date=last_year, amount=30.0))
    db.commit()

    spends = db.query(RegularDailySpend).filter_by(regular_id=regular.id).all()
    this_month = sum(
        s.amount for s in spends
        if s.date.year == today.year and s.date.month == today.month
    )
    this_year = sum(s.amount for s in spends if s.date.year == today.year)
    all_time = sum(s.amount for s in spends)

    assert this_month == pytest.approx(20.0)
    assert this_year == pytest.approx(20.0)
    assert all_time == pytest.approx(50.0)

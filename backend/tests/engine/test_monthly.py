"""Known-answer tests for engine.monthly.monthly_summary."""
from datetime import date
from app.engine.monthly import monthly_summary


def test_empty_returns_empty():
    assert monthly_summary([]) == []


def test_single_month_basic():
    day_data = [
        (date(2024, 1, 1), 100.0),
        (date(2024, 1, 2), 120.0),
        (date(2024, 1, 3), 80.0),
    ]
    months = monthly_summary(day_data)
    assert len(months) == 1
    m = months[0]
    assert m['year'] == 2024
    assert m['month'] == 1
    assert m['month_label'] == 'Jan 2024'
    assert m['total_customers'] == 300.0
    assert m['logged_days'] == 3
    assert abs(m['avg_daily_customers'] - 100.0) < 0.1
    assert m['mom_pct_change'] is None


def test_first_month_mom_is_none():
    months = monthly_summary([(date(2024, 6, 1), 50.0)])
    assert months[0]['mom_pct_change'] is None


def test_two_months_mom_increase():
    # Jan avg = 100, Feb avg = 120  →  +20.0%
    day_data = [
        (date(2024, 1, 1), 100.0),
        (date(2024, 1, 2), 100.0),
        (date(2024, 2, 1), 120.0),
        (date(2024, 2, 2), 120.0),
    ]
    months = monthly_summary(day_data)
    assert len(months) == 2
    assert months[0]['mom_pct_change'] is None
    assert abs(months[1]['mom_pct_change'] - 20.0) < 0.1


def test_mom_decrease():
    # Jan avg = 200, Feb avg = 100  →  -50.0%
    day_data = [
        (date(2024, 1, 1), 200.0),
        (date(2024, 2, 1), 100.0),
    ]
    months = monthly_summary(day_data)
    assert abs(months[1]['mom_pct_change'] - (-50.0)) < 0.1


def test_three_month_chain():
    # Jan=100, Feb=110, Mar=99
    # Feb change: (110-100)/100 = +10%
    # Mar change: (99-110)/110 ≈ -10%
    day_data = [
        (date(2024, 1, 1), 100.0),
        (date(2024, 2, 1), 110.0),
        (date(2024, 3, 1),  99.0),
    ]
    months = monthly_summary(day_data)
    assert months[0]['mom_pct_change'] is None
    assert abs(months[1]['mom_pct_change'] - 10.0) < 0.1
    assert abs(months[2]['mom_pct_change'] - (-10.0)) < 0.1


def test_missing_days_not_zero_filled():
    # Only 3 days logged in January — avg should be sum/3, NOT sum/31
    day_data = [
        (date(2024, 1,  1), 90.0),
        (date(2024, 1, 15), 90.0),
        (date(2024, 1, 31), 90.0),
    ]
    months = monthly_summary(day_data)
    m = months[0]
    assert m['logged_days'] == 3
    assert abs(m['avg_daily_customers'] - 90.0) < 0.1   # NOT 90*3/31 ≈ 8.7
    assert m['total_customers'] == 270.0


def test_months_sorted_ascending():
    # Records arrive out of order; output must be Jan → Feb → Mar
    day_data = [
        (date(2024, 3, 1), 50.0),
        (date(2024, 1, 1), 100.0),
        (date(2024, 2, 1),  80.0),
    ]
    months = monthly_summary(day_data)
    labels = [m['month_label'] for m in months]
    assert labels == ['Jan 2024', 'Feb 2024', 'Mar 2024']


def test_month_label_format():
    months = monthly_summary([(date(2025, 12, 5), 55.0)])
    assert months[0]['month_label'] == 'Dec 2025'


def test_multi_year_span():
    # Dec 2023 avg=80, Jan 2024 avg=100 → +25%
    day_data = [
        (date(2023, 12, 1), 80.0),
        (date(2024,  1, 1), 100.0),
    ]
    months = monthly_summary(day_data)
    assert months[0]['year'] == 2023
    assert months[1]['year'] == 2024
    assert abs(months[1]['mom_pct_change'] - 25.0) < 0.1


def test_multiple_days_same_month_avg():
    # 4 days: 10, 20, 30, 40 → avg = 25
    day_data = [(date(2024, 5, i), float(i * 10)) for i in range(1, 5)]
    m = monthly_summary(day_data)[0]
    assert abs(m['avg_daily_customers'] - 25.0) < 0.1
    assert m['total_customers'] == 100.0
    assert m['logged_days'] == 4

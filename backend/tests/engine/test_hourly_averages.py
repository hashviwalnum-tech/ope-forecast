"""Known-answer tests for engine.live_sales.hourly_averages."""
from datetime import date

from app.engine.live_sales import hourly_averages

D1 = date(2024, 1, 1)
D2 = date(2024, 1, 2)
D3 = date(2024, 1, 3)


def test_empty_returns_empty():
    assert hourly_averages([]) == []


def test_single_event():
    # 1 tap at hour 9 on 1 day → avg=1.0, n_days=1
    assert hourly_averages([(D1, 9, 1, 1.0)]) == [(9, 1.0, 1)]


def test_two_taps_same_day_same_hour():
    # 2 taps in hour 9 on 1 day → avg=2.0
    result = hourly_averages([(D1, 9, 1, 1.0), (D1, 9, 2, 1.0)])
    assert result == [(9, 2.0, 1)]


def test_one_tap_each_day_same_hour():
    # 1 tap on D1 + 1 tap on D2 at hour 9 → n_days=2, avg=2/2=1.0
    result = hourly_averages([(D1, 9, 1, 1.0), (D2, 9, 1, 1.0)])
    assert result == [(9, 1.0, 2)]


def test_uneven_taps_across_days():
    # D1: 3 taps at hour 9; D2: 1 tap at hour 9 → total=4, n_days=2, avg=2.0
    events = [
        (D1, 9, 1, 1.0), (D1, 9, 2, 1.0), (D1, 9, 3, 1.0),
        (D2, 9, 1, 1.0),
    ]
    assert hourly_averages(events) == [(9, 2.0, 2)]


def test_multiple_hours_returned_sorted():
    events = [(D1, 12, 1, 1.0), (D1, 9, 1, 1.0), (D1, 17, 1, 1.0)]
    hours = [r[0] for r in hourly_averages(events)]
    assert hours == [9, 12, 17]


def test_n_days_counts_distinct_dates():
    # 3 events across 2 days at hour 9 → n_days=2, avg=3/2=1.5
    events = [(D1, 9, 1, 1.0), (D1, 9, 2, 1.0), (D2, 9, 1, 1.0)]
    _, avg, n = hourly_averages(events)[0]
    assert n == 2
    assert avg == 1.5


def test_three_days_two_hours():
    # D1: 6 at 9am, 2 at 5pm; D2: 3 at 9am; D3: 3 at 9am, 4 at 5pm
    # n_days=3; 9am total=12 → avg=4.0; 5pm total=6 → avg=2.0
    events = [
        (D1, 9, 1, 1.0), (D1, 9, 1, 1.0), (D1, 9, 1, 1.0),
        (D1, 9, 1, 1.0), (D1, 9, 1, 1.0), (D1, 9, 1, 1.0),
        (D1, 17, 1, 1.0), (D1, 17, 1, 1.0),
        (D2, 9, 1, 1.0), (D2, 9, 1, 1.0), (D2, 9, 1, 1.0),
        (D3, 9, 1, 1.0), (D3, 9, 1, 1.0), (D3, 9, 1, 1.0),
        (D3, 17, 1, 1.0), (D3, 17, 1, 1.0), (D3, 17, 1, 1.0), (D3, 17, 1, 1.0),
    ]
    result = hourly_averages(events)
    by_hour = {h: avg for h, avg, _ in result}
    assert by_hour[9]  == 4.0
    assert by_hour[17] == 2.0


def test_open_hours_filter_excludes_closed_hour():
    # hour 6 is before opening; only hour 9 is open
    events = [(D1, 6, 1, 1.0), (D1, 9, 1, 1.0)]
    result = hourly_averages(events, open_hours={9, 10, 11, 12})
    assert len(result) == 1
    assert result[0][0] == 9


def test_open_hours_none_includes_all():
    events = [(D1, 2, 1, 1.0), (D1, 23, 1, 1.0)]
    hours = [r[0] for r in hourly_averages(events, open_hours=None)]
    assert 2 in hours and 23 in hours


def test_all_events_outside_open_hours_returns_empty():
    events = [(D1, 7, 1, 1.0), (D1, 8, 1, 1.0)]
    result = hourly_averages(events, open_hours={9, 10, 11})
    assert result == []

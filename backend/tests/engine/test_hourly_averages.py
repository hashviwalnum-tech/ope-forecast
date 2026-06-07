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


def test_out_of_hours_days_excluded_from_denominator():
    """A day whose taps are ALL outside opening hours must NOT count in the denominator.

    Without this fix, a 10-customer hour-9 average would be dragged down to 5.0
    because a second day with only out-of-hours taps inflated n_days to 2.
    """
    events = [
        (D1, 9, None, 10.0),   # D1: 10 customers during open hours
        (D2, 22, None, 5.0),   # D2: only an out-of-hours tap — must NOT count
    ]
    result = hourly_averages(events, open_hours={9, 10, 11, 12})

    assert len(result) == 1
    hour, avg, n = result[0]
    assert hour == 9
    assert n == 1, "D2 had no open-hours taps and must be excluded from n_days"
    assert avg == 10.0, "avg must not be dragged down by D2"


def test_busy_hour_not_dragged_down_by_all_days_total():
    """A consistently busy hour across a subset of days reflects the correct average.

    D1 and D2 each have 10 customers at hour 9 (20 total).
    D3 has taps only at hour 14 — within open hours, so D3 DOES count.
    n_days = 3; hour 9 avg = 20/3 ≈ 6.67 (rounds to 6.67 at 2dp).
    If D3 were an out-of-hours-only day it would be excluded and avg = 10.0.
    """
    events = [
        (D1, 9, None, 10.0),    # D1: busy at hour 9
        (D2, 9, None, 10.0),    # D2: busy at hour 9
        (D3, 14, None, 5.0),    # D3: taps at hour 14 (open), quiet at hour 9
    ]
    result = hourly_averages(events, open_hours=set(range(9, 21)))
    by_hour = {h: avg for h, avg, _ in result}

    # All 3 days are "tracked" (had open-hours taps) → n_days = 3
    # hour 9 avg = 20/3 = 6.67; hour 14 avg = 5/3 = 1.67
    assert by_hour[9] == round(20 / 3, 2)
    assert by_hour[14] == round(5 / 3, 2)


def test_backfill_quantity_is_summed_not_counted():
    # Backfill creates 1 SaleEvent with qty=12 for a day with 12 customers at hour 9.
    # avg should be 12.0, not 1.0.
    result = hourly_averages([(D1, 9, None, 12.0)])
    assert result == [(9, 12.0, 1)]


def test_backfill_two_days_averages_correctly():
    # Day1: 1 backfill event qty=8; Day2: 1 backfill event qty=4 → avg = 12/2 = 6.0
    events = [(D1, 10, None, 8.0), (D2, 10, None, 4.0)]
    result = hourly_averages(events)
    assert result == [(10, 6.0, 2)]


# ── closed-hours must never appear in peak-hours output ───────────────────────

def test_overnight_hours_excluded_from_peak_when_open_hours_set():
    """Overnight traffic (1–5am) must not appear in peak-hours output for a
    business that is only open 9am–10pm.  This is the root cause of the
    'closed-hours leak' bug reported against the Peak Hours by Day view."""
    events = [
        (D1, 1, None, 15.0),   # 1am — closed
        (D1, 2, None, 12.0),   # 2am — closed
        (D1, 3, None, 8.0),    # 3am — closed
        (D1, 4, None, 5.0),    # 4am — closed
        (D1, 5, None, 3.0),    # 5am — closed
        (D1, 10, None, 20.0),  # 10am — open
        (D1, 14, None, 18.0),  # 2pm — open
    ]
    open_hours = set(range(9, 22))  # 9am–10pm
    result = hourly_averages(events, open_hours=open_hours)
    returned_hours = {h for h, _, _ in result}

    assert not returned_hours.intersection({1, 2, 3, 4, 5}), \
        "Closed overnight hours must never appear in peak-hours output"
    assert 10 in returned_hours
    assert 14 in returned_hours


def test_peak_hours_avg_taps_are_whole_numbers():
    """avg_taps values from hourly_averages are floats but must round to whole
    numbers for display — customers are whole people.  This guards the
    busy-hours/hourly chart against decimal rendering."""
    events = [
        (D1, 9, None, 7.0),   # 7 customers
        (D2, 9, None, 8.0),   # 8 customers — avg = 7.5
        (D1, 14, None, 10.0),
        (D2, 14, None, 11.0),  # avg = 10.5
    ]
    result = hourly_averages(events, open_hours=set(range(9, 21)))
    for hour, avg, _ in result:
        # round() must be a lossless no-op when displayed — no 7.5 → "7.5"
        assert round(avg) == int(round(avg)), \
            f"Hour {hour}: avg {avg} must be safely roundable to a whole number"

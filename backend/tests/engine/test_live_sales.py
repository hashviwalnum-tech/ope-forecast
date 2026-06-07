"""Known-answer tests for engine.live_sales.rollup_by_hour and hourly_averages."""
from datetime import date

from app.engine.live_sales import hourly_averages, rollup_by_hour


def test_empty_returns_empty():
    assert rollup_by_hour([]) == []


def test_single_event():
    result = rollup_by_hour([(9, 1, 2.0)])
    assert result == [(9, 1, {1: 2.0})]


def test_customer_only_tap_none_product():
    result = rollup_by_hour([(10, None, 1.0)])
    assert result == [(10, 1, {None: 1.0})]


def test_two_events_same_hour_same_product_summed():
    result = rollup_by_hour([(11, 3, 1.0), (11, 3, 2.0)])
    assert result == [(11, 2, {3: 3.0})]


def test_two_events_same_hour_different_products():
    result = rollup_by_hour([(14, 1, 1.0), (14, 2, 5.0)])
    assert result == [(14, 2, {1: 1.0, 2: 5.0})]


def test_mixed_product_and_none_same_hour():
    result = rollup_by_hour([(9, 1, 1.0), (9, None, 1.0)])
    hour, taps, totals = result[0]
    assert hour == 9
    assert taps == 2
    assert totals[1] == 1.0
    assert totals[None] == 1.0


def test_multiple_hours_sorted_ascending():
    events = [(14, 1, 1.0), (8, 1, 1.0), (11, 1, 1.0)]
    result = rollup_by_hour(events)
    assert [r[0] for r in result] == [8, 11, 14]


def test_tap_count_per_hour_is_number_of_events():
    # 3 taps at hour 10, each qty=0.5
    events = [(10, 1, 0.5), (10, 1, 0.5), (10, 2, 0.5)]
    result = rollup_by_hour(events)
    assert result[0][1] == 3        # tap count
    assert result[0][2][1] == 1.0   # product 1 total
    assert result[0][2][2] == 0.5   # product 2 total


def test_only_hours_with_events_are_included():
    # Hour 0 and hour 23 only
    result = rollup_by_hour([(0, 1, 1.0), (23, 2, 3.0)])
    assert len(result) == 2
    assert result[0][0] == 0
    assert result[1][0] == 23


def test_quantity_greater_than_one():
    # A tap records 4 units (e.g. "4 coffees")
    result = rollup_by_hour([(12, 5, 4.0)])
    assert result == [(12, 1, {5: 4.0})]


# ── hourly_averages — whole-number display guard ───────────────────────────────
# avg_taps is an average and naturally a float (e.g. 12.33).  The UI MUST display
# it as round(avg_taps), never as avg_taps.toFixed(1), because customers are whole
# people.  These tests verify the engine values are safe to round.

def test_hourly_averages_known_answer():
    """Two-day dataset: hour 9 has 7 and 8 customers → avg = 7.5, rounds to 8."""
    events = [
        (date(2025, 9, 8), 9, None, 7.0),
        (date(2025, 9, 9), 9, None, 8.0),
    ]
    results = hourly_averages(events)
    assert len(results) == 1
    hour, avg, n = results[0]
    assert hour == 9
    assert n == 2
    assert abs(avg - 7.5) < 1e-9
    assert round(avg) == 8  # display shows 8, never "7.5"


def test_hourly_averages_whole_number_when_even():
    """When the average divides evenly, round() is a no-op — still a float from engine."""
    events = [
        (date(2025, 9, 1), 10, None, 12.0),
        (date(2025, 9, 2), 10, None, 12.0),
    ]
    _, avg, _ = hourly_averages(events)[0]
    assert avg == 12.0
    assert round(avg) == 12


def test_hourly_averages_fractional_rounds_correctly():
    """Three-day dataset: avg = 12.33… rounds to 12, not 13."""
    events = [
        (date(2025, 9, 1), 10, None, 12.0),
        (date(2025, 9, 2), 10, None, 12.0),
        (date(2025, 9, 3), 10, None, 13.0),
    ]
    _, avg, _ = hourly_averages(events)[0]
    # avg = 37/3 ≈ 12.33 — must NOT be shown as "12.3"; must show as 12
    assert round(avg) == 12


def test_hourly_averages_open_hours_filter_excludes_outside():
    """Out-of-hours events are excluded when open_hours is specified."""
    events = [
        (date(2025, 9, 8), 9,  None, 5.0),   # in hours
        (date(2025, 9, 8), 22, None, 10.0),  # outside hours
    ]
    filtered = hourly_averages(events, open_hours={9, 10, 11})
    assert len(filtered) == 1
    assert filtered[0][0] == 9  # only hour 9 returned


def test_hourly_averages_empty_returns_empty():
    assert hourly_averages([]) == []

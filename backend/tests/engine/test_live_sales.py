"""Known-answer tests for engine.live_sales.rollup_by_hour and hourly_averages."""
from datetime import date

from app.engine.live_sales import (
    compute_open_hours,
    hourly_averages,
    reconcile_customers_with_hours,
    rollup_by_hour,
    _DEFAULT_OPEN_HOURS,
)


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


def test_hourly_averages_open_hours_only_days_count_in_denominator():
    """Days with exclusively out-of-hours taps must not inflate the denominator.

    Without the fix: n_days = 2 (D1 and D2 both counted), avg = 10.0/2 = 5.0.
    With the fix: n_days = 1 (only D1 had an open-hours tap), avg = 10.0/1 = 10.0.
    """
    d1 = date(2025, 9, 8)
    d2 = date(2025, 9, 9)
    events = [
        (d1, 9, None, 10.0),   # D1: tap within open hours
        (d2, 22, None, 5.0),   # D2: tap outside open hours only
    ]
    result = hourly_averages(events, open_hours={9, 10, 11})
    assert len(result) == 1
    _, avg, n = result[0]
    assert n == 1
    assert avg == 10.0  # not dragged down to 5.0 by D2


# ── reconcile_customers_with_hours — hours-vs-total three-case rule ────────────

def test_reconcile_no_hours_uses_manual():
    """No hourly data at all → manual total returned unchanged."""
    customers, note = reconcile_customers_with_hours(50, 0.0)
    assert customers == 50
    assert "manual" in note


def test_reconcile_case1_hours_greater_than_manual():
    """Case 1: hours_sum > manual_total → hours sum becomes the total."""
    customers, note = reconcile_customers_with_hours(50, 70.0)
    assert customers == 70
    assert "hours" in note


def test_reconcile_case1_rounds_correctly():
    """Case 1: fractional hours sum is rounded to the nearest integer."""
    customers, _ = reconcile_customers_with_hours(30, 42.6)
    assert customers == 43


def test_reconcile_case2_no_manual_uses_hours():
    """Case 2: no manual total (None) → derive total from hours sum."""
    customers, note = reconcile_customers_with_hours(None, 35.0)
    assert customers == 35
    assert "hours" in note


def test_reconcile_case2_zero_manual_uses_hours():
    """Case 2: manual_total=0 treated as 'not entered' → hours sum used."""
    customers, note = reconcile_customers_with_hours(0, 40.0)
    assert customers == 40
    assert "hours" in note


def test_reconcile_case3_hours_equal_keeps_manual():
    """Case 3 boundary: hours_sum == manual_total → keep manual."""
    customers, note = reconcile_customers_with_hours(50, 50.0)
    assert customers == 50
    assert "manual" in note


def test_reconcile_case3_hours_less_keeps_manual():
    """Case 3: hours_sum < manual_total → keep manual (gap = unknown hours)."""
    customers, note = reconcile_customers_with_hours(60, 40.0)
    assert customers == 60
    assert "manual" in note


# ── compute_open_hours — ROOT 2 opening-hours filter ─────────────────────────

def test_compute_open_hours_normal_range():
    """Normal case: close > open → set(range(open, close))."""
    result = compute_open_hours({"opening_hour": 9, "closing_hour": 17})
    assert result == frozenset(range(9, 17))
    assert 9 in result
    assert 16 in result
    assert 17 not in result
    assert 1 not in result  # 1am must be excluded


def test_compute_open_hours_no_1am_for_9_17():
    """Spec requirement: with hours 9–17, no 1–5am hours ever appear."""
    result = compute_open_hours({"opening_hour": 9, "closing_hour": 17})
    for h in range(0, 9):
        assert h not in result, f"hour {h} must be excluded for 9–17 business"
    for h in range(17, 24):
        assert h not in result, f"hour {h} must be excluded for 9–17 business"


def test_compute_open_hours_overnight_wrap():
    """Overnight wrap-around (e.g. 22:00–06:00): range(22,24) ∪ range(0,6)."""
    result = compute_open_hours({"opening_hour": 22, "closing_hour": 6})
    expected = frozenset(range(22, 24)) | frozenset(range(0, 6))
    assert result == expected
    assert 22 in result
    assert 23 in result
    assert 0 in result
    assert 5 in result
    assert 6 not in result  # closing hour excluded (open = [open, close))
    assert 10 not in result  # midday is closed


def test_compute_open_hours_not_configured_returns_default():
    """No opening_hour/closing_hour → returns _DEFAULT_OPEN_HOURS, not all 24 hours."""
    result = compute_open_hours({})
    assert result == _DEFAULT_OPEN_HOURS
    # Default must exclude overnight hours (e.g. 1–5am)
    for h in range(0, 6):
        assert h not in result, f"overnight hour {h} must be excluded from default"


def test_compute_open_hours_not_configured_excludes_midnight():
    """Unconfigured business must never include 1–5am (spec: prompt/default sensibly)."""
    result = compute_open_hours({"some_other_setting": "value"})
    assert 1 not in result
    assert 3 not in result
    assert 5 not in result


def test_compute_open_hours_24h_when_equal():
    """open == close → treat as 24-hour operation (all hours)."""
    result = compute_open_hours({"opening_hour": 9, "closing_hour": 9})
    assert result == frozenset(range(0, 24))


def test_hourly_analytics_respects_open_hours_9_17():
    """With 9–17 hours, no taps from 1–5am ever appear in hourly averages."""
    events = [
        (date(2025, 9, 1), 9,  None, 10.0),   # open hour
        (date(2025, 9, 1), 13, None, 8.0),    # open hour
        (date(2025, 9, 1), 1,  None, 99.0),   # 1am — must be excluded
        (date(2025, 9, 1), 3,  None, 50.0),   # 3am — must be excluded
    ]
    open_hrs = compute_open_hours({"opening_hour": 9, "closing_hour": 17})
    avgs = hourly_averages(events, open_hours=open_hrs)
    returned_hours = {h for h, _, _ in avgs}
    assert 1 not in returned_hours, "1am must never appear in peak hours for 9–17 business"
    assert 3 not in returned_hours, "3am must never appear in peak hours for 9–17 business"
    assert 9 in returned_hours
    assert 13 in returned_hours


def test_reconcile_closed_hour_not_counted():
    """Closed-hour entries must be excluded from the hours sum before reconciliation.

    A day with open hours 9–17 has 30 customers at hour 9 (open) and
    20 at hour 22 (closed). The correct sum is 30; 50 would be wrong.
    This proves the caller must filter to open hours before calling reconcile.
    """
    all_entries = {9: 30, 22: 20}
    open_hours = set(range(9, 17))

    open_sum = sum(v for h, v in all_entries.items() if h in open_hours)   # 30
    full_sum = sum(all_entries.values())                                     # 50

    eff_correct, _ = reconcile_customers_with_hours(None, open_sum)
    eff_wrong,   _ = reconcile_customers_with_hours(None, full_sum)

    assert eff_correct == 30, "Only open-hours sum must be used"
    assert eff_wrong   == 50, "Shows what happens when closed hour is NOT filtered"
    assert eff_correct != eff_wrong

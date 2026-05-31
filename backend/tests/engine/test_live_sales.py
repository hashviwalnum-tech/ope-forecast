"""Known-answer tests for engine.live_sales.rollup_by_hour."""
from app.engine.live_sales import rollup_by_hour


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

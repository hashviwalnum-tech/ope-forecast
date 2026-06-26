"""
Known-answer tests for engine/product_forecast.py.

The core function is build_product_demand_series().  The ordering math it
feeds into is already covered by test_ordering.py; here we focus on the
series-construction behaviour: pre-tracking trimming, zero-fill after first
sale, and correct date alignment.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.engine.product_forecast import build_product_demand_series, round_qty

# ── shared fixture dates ──────────────────────────────────────────────────────

START = date(2025, 1, 1)  # Wednesday
D = [START + timedelta(days=i) for i in range(20)]


# ── no-data edge cases ────────────────────────────────────────────────────────

def test_empty_sales_returns_empty():
    records = [(1, D[0]), (2, D[1])]
    demand, dates = build_product_demand_series(records, {})
    assert demand == []
    assert dates == []


def test_empty_records_returns_empty():
    demand, dates = build_product_demand_series([], {1: 5.0})
    assert demand == []
    assert dates == []


def test_sales_not_in_records_returns_empty():
    # Sales reference a day_record_id that isn't in the backbone
    records = [(1, D[0]), (2, D[1])]
    demand, dates = build_product_demand_series(records, {99: 5.0})
    assert demand == []
    assert dates == []


# ── single-point cases ───────────────────────────────────────────────────────

def test_single_sale_single_record():
    records = [(1, D[0])]
    demand, dates = build_product_demand_series(records, {1: 10.0})
    assert demand == [10.0]
    assert dates == [D[0]]


# ── pre-tracking trim ────────────────────────────────────────────────────────

def test_pre_tracking_days_excluded():
    """Days before the first sale are dropped, not zeroed."""
    records = [(1, D[0]), (2, D[1]), (3, D[2]), (4, D[3])]
    sales = {3: 5.0, 4: 3.0}
    demand, dates = build_product_demand_series(records, sales)
    assert len(demand) == 2
    assert demand == [5.0, 3.0]
    assert dates[0] == D[2]


def test_only_first_record_has_sale():
    records = [(1, D[0]), (2, D[1]), (3, D[2])]
    sales = {1: 7.0}
    demand, dates = build_product_demand_series(records, sales)
    assert len(demand) == 3
    assert demand == [7.0, 0.0, 0.0]
    assert dates[0] == D[0]


def test_only_last_record_has_sale():
    records = [(1, D[0]), (2, D[1]), (3, D[2])]
    sales = {3: 4.0}
    demand, dates = build_product_demand_series(records, sales)
    assert demand == [4.0]
    assert dates == [D[2]]


# ── zero-fill after first sale ───────────────────────────────────────────────

def test_gap_after_first_sale_is_zero():
    """A day after first sale with no SaleRecord means zero sales (not missing)."""
    records = [(1, D[0]), (2, D[1]), (3, D[2])]
    sales = {1: 8.0, 3: 6.0}
    demand, dates = build_product_demand_series(records, sales)
    assert demand == [8.0, 0.0, 6.0]
    assert len(dates) == 3


def test_multiple_zeros_in_middle():
    records = [(i, D[i - 1]) for i in range(1, 8)]
    sales = {1: 10.0, 7: 5.0}
    demand, dates = build_product_demand_series(records, sales)
    assert demand == [10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 5.0]
    assert len(dates) == 7


# ── date alignment ───────────────────────────────────────────────────────────

def test_dates_aligned_with_demand():
    records = [(1, D[3]), (2, D[4]), (3, D[5])]
    sales = {2: 7.0}  # first sale on second record
    demand, dates = build_product_demand_series(records, sales)
    assert demand == [7.0, 0.0]
    assert dates == [D[4], D[5]]


def test_all_days_have_sales():
    records = [(i, D[i - 1]) for i in range(1, 8)]
    sales = {i: float(i * 3) for i in range(1, 8)}
    demand, dates = build_product_demand_series(records, sales)
    assert demand == [3.0, 6.0, 9.0, 12.0, 15.0, 18.0, 21.0]
    assert len(dates) == 7


# ── weekday-based known-answer ───────────────────────────────────────────────

def test_weekly_pattern_preserved():
    """14 days: Mondays sell 10, all other days sell 2."""
    # D[0] is Wednesday 2025-01-01; the first Monday is D[5] = 2025-01-06
    records = [(i + 1, D[i]) for i in range(14)]
    sales = {}
    for i, d in enumerate(D[:14]):
        if d.weekday() == 0:  # Monday
            sales[i + 1] = 10.0
        else:
            sales[i + 1] = 2.0

    demand, dates = build_product_demand_series(records, sales)
    assert len(demand) == 14
    for v, d in zip(demand, dates):
        expected = 10.0 if d.weekday() == 0 else 2.0
        assert v == expected, f"{d}: expected {expected}, got {v}"


def test_pre_tracking_count_known_answer():
    """Verify exactly how many days are trimmed from the front."""
    # 5 records, first sale at index 3 (day 4), so 3 days trimmed, 2 remain
    records = [(i, D[i - 1]) for i in range(1, 6)]
    sales = {4: 9.0}  # day 4 is the first (and only) sale
    demand, dates = build_product_demand_series(records, sales)
    # starts at D[3] (index 3); D[4] gets zero-fill
    assert len(demand) == 2
    assert demand[0] == 9.0
    assert demand[1] == 0.0
    assert dates[0] == D[3]
    assert dates[1] == D[4]


# ── round_qty guard tests (whole-unit regression prevention) ─────────────────
# These tests exist to catch any future regression where whole-unit products
# produce fractional forecast or order quantities.  The function is the single
# source of truth used by all forecast and ordering outputs in analytics.py.

@pytest.mark.parametrize("raw,expected", [
    (0.1, 0.0),
    (0.5, 0.0),   # banker's rounding: 0.5 → 0 (round half to even)
    (0.7, 1.0),
    (1.3, 1.0),
    (1.5, 2.0),
    (3.7, 4.0),
    (9.9, 10.0),
    (99.9, 100.0),
    (0.0, 0.0),
    (5.0, 5.0),
])
def test_whole_unit_never_fractional(raw: float, expected: float):
    """Whole-unit mode must always produce an integer-valued float."""
    result = round_qty(raw, "whole")
    # Must equal the expected whole number
    assert result == expected, f"round_qty({raw}, 'whole') = {result}, want {expected}"
    # Must have no fractional part (i.e. int(result) == result)
    assert result == float(int(result)), f"round_qty({raw}, 'whole') = {result} has fractional part"


def test_whole_unit_result_is_float():
    """round_qty always returns a float, even for whole-unit mode."""
    assert isinstance(round_qty(3.0, "whole"), float)
    assert isinstance(round_qty(3.7, "whole"), float)


def test_decimal_unit_allows_fractional():
    """Decimal-unit mode rounds to 2 decimal places, not to whole number."""
    assert round_qty(3.756, "decimal") == 3.76
    assert round_qty(1.001, "decimal") == 1.0
    assert round_qty(2.505, "decimal") == 2.5  # banker's rounding at 3rd decimal


def test_decimal_unit_preserves_two_places():
    assert round_qty(2.50, "decimal") == 2.5
    assert round_qty(0.01, "decimal") == 0.01


def test_whole_unit_large_value():
    """Large values round correctly without overflow."""
    assert round_qty(9999.6, "whole") == 10000.0
    assert round_qty(9999.4, "whole") == 9999.0


# ── reorder flow regression guard ────────────────────────────────────────────
# This has regressed repeatedly: a whole-unit product's reorder advice (suggested
# order qty, reorder point, safety stock, avg daily demand) must NEVER carry a
# fractional part.  round_qty is the single choke-point in analytics.py for all
# of those values.  If any path skips it, a whole-unit product displays "45.3".

@pytest.mark.parametrize("raw", [0.3, 0.7, 1.2, 5.8, 12.6, 45.3, 99.9, 233.4])
def test_reorder_flow_whole_unit_never_fractional(raw: float):
    """Any raw ordering-math value must produce a whole number for unit_mode='whole'."""
    result = round_qty(raw, "whole")
    assert result == float(int(result)), (
        f"round_qty({raw}, 'whole') = {result}: whole-unit reorder qty has fractional part"
    )


def test_reorder_flow_decimal_unit_preserves_fractions():
    """Decimal-unit products keep their fractional reorder quantities (2 d.p.)."""
    assert round_qty(45.3, "decimal") == 45.3
    assert round_qty(45.376, "decimal") == 45.38
    assert round_qty(0.755, "decimal") == 0.76

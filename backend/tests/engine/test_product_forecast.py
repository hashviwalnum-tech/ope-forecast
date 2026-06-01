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

from app.engine.product_forecast import build_product_demand_series

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

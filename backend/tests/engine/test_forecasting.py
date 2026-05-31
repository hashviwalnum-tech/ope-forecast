"""
Known-answer tests for engine/forecasting.py — every formula from spec section 12.
"""
import pytest
from app.engine.forecasting import (
    simple_moving_average,
    weighted_moving_average,
    exponential_smoothing,
    linear_trend,
    seasonality_index,
)


# ---------------------------------------------------------------------------
# simple_moving_average
# ---------------------------------------------------------------------------

def test_sma_spec_example():
    # Spec section 12: data [10,12,14,16], n=3 → (12+14+16)/3 = 14
    assert simple_moving_average([10, 12, 14, 16], 3) == pytest.approx(14.0)


def test_sma_uses_last_n():
    # Only the tail matters — earlier values are ignored
    assert simple_moving_average([999, 10, 20, 30], 3) == pytest.approx(20.0)


def test_sma_n_equals_length():
    assert simple_moving_average([10, 20, 30], 3) == pytest.approx(20.0)


def test_sma_n1():
    assert simple_moving_average([5, 9, 7], 1) == pytest.approx(7.0)


def test_sma_insufficient_data():
    with pytest.raises(ValueError):
        simple_moving_average([10, 20], 5)


def test_sma_n_zero():
    with pytest.raises(ValueError):
        simple_moving_average([10, 20], 0)


# ---------------------------------------------------------------------------
# weighted_moving_average
# ---------------------------------------------------------------------------

def test_wma_spec_example():
    # Spec section 12: last three [10,20,30] (oldest→newest), weights [0.2,0.3,0.5] → 23
    assert weighted_moving_average([10, 20, 30], [0.2, 0.3, 0.5]) == pytest.approx(23.0)


def test_wma_uses_tail_of_longer_series():
    # Prepend a value that should be ignored
    assert weighted_moving_average([99, 10, 20, 30], [0.2, 0.3, 0.5]) == pytest.approx(23.0)


def test_wma_single_weight():
    assert weighted_moving_average([5, 7, 9], [1.0]) == pytest.approx(9.0)


def test_wma_weights_not_sum_to_one():
    with pytest.raises(ValueError):
        weighted_moving_average([10, 20, 30], [0.2, 0.3, 0.4])


def test_wma_insufficient_data():
    with pytest.raises(ValueError):
        weighted_moving_average([10], [0.5, 0.5])


# ---------------------------------------------------------------------------
# exponential_smoothing
# ---------------------------------------------------------------------------

def test_exp_smoothing_spec_example():
    # Spec section 12: α=0.3, F=100, A=120 → 0.3*120 + 0.7*100 = 106
    assert exponential_smoothing(0.3, 100.0, 120.0) == pytest.approx(106.0)


def test_exp_smoothing_alpha_one_half():
    # F = 0.5*80 + 0.5*60 = 70
    assert exponential_smoothing(0.5, 60.0, 80.0) == pytest.approx(70.0)


def test_exp_smoothing_alpha_must_be_in_open_interval():
    with pytest.raises(ValueError):
        exponential_smoothing(0.0, 100.0, 120.0)
    with pytest.raises(ValueError):
        exponential_smoothing(1.0, 100.0, 120.0)
    with pytest.raises(ValueError):
        exponential_smoothing(-0.1, 100.0, 120.0)


# ---------------------------------------------------------------------------
# linear_trend
# ---------------------------------------------------------------------------

def test_linear_trend_spec_example():
    # Spec section 12: points (1,10),(2,12),(3,14) → slope 2, intercept 8; t=4 → 16
    xs = [1, 2, 3]
    ys = [10, 12, 14]
    assert linear_trend(xs, ys, 4) == pytest.approx(16.0)


def test_linear_trend_slope_and_intercept():
    # Same data — verify intermediate values indirectly via t=0 (intercept) and t=1 (intercept+slope)
    xs = [1, 2, 3]
    ys = [10, 12, 14]
    assert linear_trend(xs, ys, 0) == pytest.approx(8.0)   # intercept = 8
    assert linear_trend(xs, ys, 1) == pytest.approx(10.0)  # 8 + 2*1


def test_linear_trend_two_points():
    # Minimum valid input
    assert linear_trend([0, 1], [5, 10], 2) == pytest.approx(15.0)


def test_linear_trend_insufficient_data():
    with pytest.raises(ValueError):
        linear_trend([1], [10], 2)


def test_linear_trend_mismatched_lengths():
    with pytest.raises(ValueError):
        linear_trend([1, 2, 3], [10, 12], 4)


# ---------------------------------------------------------------------------
# seasonality_index
# ---------------------------------------------------------------------------

def test_seasonality_index_spec_example():
    # Spec section 12: overall avg 100, Saturday avg 150 → index 1.5
    assert seasonality_index(150, 100) == pytest.approx(1.5)


def test_seasonality_index_below_average_day():
    # A slow day: avg 80 vs overall 100 → 0.8
    assert seasonality_index(80, 100) == pytest.approx(0.8)


def test_seasonality_index_applied_to_base_forecast():
    # Saturday forecast = base 200 × index 1.5 = 300
    base = 200.0
    index = seasonality_index(150, 100)
    assert base * index == pytest.approx(300.0)


def test_seasonality_index_zero_overall_avg():
    with pytest.raises(ValueError):
        seasonality_index(150, 0)

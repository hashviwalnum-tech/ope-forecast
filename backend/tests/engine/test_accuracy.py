"""
Known-answer tests for engine/accuracy.py — every formula from spec section 12.
"""
import pytest
from app.engine.accuracy import (
    forecast_errors,
    mad,
    mse,
    mape,
    tracking_signal,
    coefficient_of_variation,
)

# Shared fixture used across MAD, MSE, and tracking signal tests
ERRORS = [2.0, -3.0, 4.0, -1.0]


# ---------------------------------------------------------------------------
# forecast_errors
# ---------------------------------------------------------------------------

def test_forecast_errors_basic():
    assert forecast_errors([100, 200], [90, 210]) == pytest.approx([10.0, -10.0])


def test_forecast_errors_sign_convention():
    # Convention: actual − forecast; positive means under-forecast
    assert forecast_errors([50], [60]) == pytest.approx([-10.0])


def test_forecast_errors_mismatched_lengths():
    with pytest.raises(ValueError):
        forecast_errors([100, 200], [90])


# ---------------------------------------------------------------------------
# MAD
# ---------------------------------------------------------------------------

def test_mad_spec_example():
    # Spec section 12: errors [2,−3,4,−1] → (2+3+4+1)/4 = 2.5
    assert mad(ERRORS) == pytest.approx(2.5)


def test_mad_all_positive():
    assert mad([1.0, 2.0, 3.0]) == pytest.approx(2.0)


def test_mad_single_element():
    assert mad([7.0]) == pytest.approx(7.0)


def test_mad_empty():
    with pytest.raises(ValueError):
        mad([])


# ---------------------------------------------------------------------------
# MSE
# ---------------------------------------------------------------------------

def test_mse_spec_example():
    # Spec section 12: errors [2,−3,4,−1] → (4+9+16+1)/4 = 7.5
    assert mse(ERRORS) == pytest.approx(7.5)


def test_mse_single_element():
    assert mse([3.0]) == pytest.approx(9.0)


def test_mse_empty():
    with pytest.raises(ValueError):
        mse([])


# ---------------------------------------------------------------------------
# MAPE
# ---------------------------------------------------------------------------

def test_mape_spec_example():
    # Spec section 12: actuals [100,200], forecasts [110,180] → (0.10+0.10)/2 = 10%
    assert mape([100, 200], [110, 180]) == pytest.approx(10.0)


def test_mape_perfect_forecast():
    assert mape([100, 200], [100, 200]) == pytest.approx(0.0)


def test_mape_excludes_zero_actuals():
    # The zero actual is skipped; only the [100→110] pair contributes → 10%
    assert mape([0, 100], [999, 110]) == pytest.approx(10.0)


def test_mape_all_zero_actuals():
    with pytest.raises(ValueError):
        mape([0, 0], [10, 20])


def test_mape_mismatched_lengths():
    with pytest.raises(ValueError):
        mape([100, 200], [110])


# ---------------------------------------------------------------------------
# Tracking signal
# ---------------------------------------------------------------------------

def test_tracking_signal_spec_example():
    # Spec section 12: errors [2,−3,4,−1] → RSFE=2, MAD=2.5, TS=0.8
    assert tracking_signal(ERRORS) == pytest.approx(0.8)


def test_tracking_signal_positive_bias():
    # All positive errors → TS = MAD / MAD = 1... no: RSFE = sum = 6, MAD = 2 → TS = 3
    assert tracking_signal([1.0, 2.0, 3.0]) == pytest.approx(3.0)


def test_tracking_signal_zero_bias():
    # Symmetric errors → RSFE = 0
    assert tracking_signal([5.0, -5.0]) == pytest.approx(0.0)


def test_tracking_signal_empty():
    with pytest.raises(ValueError):
        tracking_signal([])


# ---------------------------------------------------------------------------
# Coefficient of variation
# ---------------------------------------------------------------------------

def test_cv_stable_demand():
    # All equal → std dev = 0 → CV = 0
    assert coefficient_of_variation([100.0, 100.0, 100.0]) == pytest.approx(0.0)


def test_cv_known_values():
    # Values [10, 20, 30] → mean=20, sample std≈10, CV=0.5
    assert coefficient_of_variation([10.0, 20.0, 30.0]) == pytest.approx(0.5)


def test_cv_zero_mean():
    with pytest.raises(ValueError):
        coefficient_of_variation([0.0, 0.0, 0.0])


def test_cv_empty():
    with pytest.raises(ValueError):
        coefficient_of_variation([])

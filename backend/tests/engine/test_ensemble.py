"""
Tests for engine/ensemble.py — the self-correcting inverse-error weighting system
described in spec sections 2 and 6.
"""
import numpy as np
import pytest
from app.engine.ensemble import model_weights, blend, prediction_interval, weekday_errors

MONDAY, SATURDAY = 0, 5


# ---------------------------------------------------------------------------
# model_weights
# ---------------------------------------------------------------------------

def test_weights_inverse_proportional():
    # errors [0.1, 0.2]: 1/0.1=10, 1/0.2=5, total=15 → [2/3, 1/3]
    w = model_weights([0.1, 0.2])
    assert w[0] == pytest.approx(2 / 3, rel=1e-9)
    assert w[1] == pytest.approx(1 / 3, rel=1e-9)


def test_weights_sum_to_one():
    w = model_weights([0.05, 0.10, 0.20, 0.08])
    assert sum(w) == pytest.approx(1.0)


def test_weights_equal_errors_give_equal_weights():
    w = model_weights([0.1, 0.1])
    assert w == pytest.approx([0.5, 0.5])


def test_weights_four_equal_models():
    w = model_weights([0.2, 0.2, 0.2, 0.2])
    assert w == pytest.approx([0.25, 0.25, 0.25, 0.25])


def test_weights_single_model():
    assert model_weights([0.5]) == pytest.approx([1.0])


def test_weights_zero_error_uses_floor():
    # Perfect model (error=0) → floored to 1e-6; gets nearly all weight
    w = model_weights([0.0, 0.1])
    assert w[0] > 0.99


def test_weights_accurate_model_dominates():
    # Model A has 4× lower error than B → should have > 75% weight
    w = model_weights([0.05, 0.20])
    assert w[0] > 0.75


def test_weights_negative_error_raises():
    with pytest.raises(ValueError):
        model_weights([-0.1, 0.2])


def test_weights_empty_raises():
    with pytest.raises(ValueError):
        model_weights([])


# ---------------------------------------------------------------------------
# blend
# ---------------------------------------------------------------------------

def test_blend_two_models():
    # predictions [100, 200], weights [2/3, 1/3] → 400/3 ≈ 133.33
    assert blend([100.0, 200.0], [2 / 3, 1 / 3]) == pytest.approx(400 / 3, rel=1e-9)


def test_blend_uniform_weights():
    assert blend([90.0, 110.0], [0.5, 0.5]) == pytest.approx(100.0)


def test_blend_all_same_prediction():
    assert blend([150.0, 150.0, 150.0], [0.2, 0.5, 0.3]) == pytest.approx(150.0)


def test_blend_single_model():
    assert blend([120.0], [1.0]) == pytest.approx(120.0)


def test_blend_mismatched_lengths():
    with pytest.raises(ValueError):
        blend([100.0, 200.0], [1.0])


def test_blend_empty():
    with pytest.raises(ValueError):
        blend([], [])


# ---------------------------------------------------------------------------
# prediction_interval
# ---------------------------------------------------------------------------

def test_interval_contains_forecast():
    lo, hi = prediction_interval(100.0, [5.0, -3.0, 4.0, -2.0, 1.0])
    assert lo < 100.0 < hi


def test_interval_known_spread():
    # errors [10, -10]: sample std = √200 ≈ 14.142, z=1 → margin ≈ 14.142
    errors = [10.0, -10.0]
    spread = float(np.std(errors, ddof=1))
    lo, hi = prediction_interval(100.0, errors, z=1.0)
    assert lo == pytest.approx(100.0 - spread)
    assert hi == pytest.approx(100.0 + spread)


def test_interval_zero_spread():
    # Identical errors → std = 0 → interval degenerates to a point
    lo, hi = prediction_interval(100.0, [0.0, 0.0, 0.0])
    assert lo == pytest.approx(100.0)
    assert hi == pytest.approx(100.0)


def test_interval_wider_with_larger_z():
    errors = [5.0, -3.0, 4.0, -2.0]
    lo1, hi1 = prediction_interval(100.0, errors, z=1.0)
    lo2, hi2 = prediction_interval(100.0, errors, z=2.0)
    assert (hi2 - lo2) == pytest.approx(2 * (hi1 - lo1))


def test_interval_symmetric_around_forecast():
    lo, hi = prediction_interval(100.0, [5.0, -5.0, 3.0, -3.0])
    assert (lo + hi) / 2 == pytest.approx(100.0)


def test_interval_insufficient_data():
    with pytest.raises(ValueError):
        prediction_interval(100.0, [5.0])       # need >= 2


def test_interval_empty():
    with pytest.raises(ValueError):
        prediction_interval(100.0, [])


# ---------------------------------------------------------------------------
# weekday_errors
# ---------------------------------------------------------------------------

def test_weekday_errors_filters_correctly():
    errors   = [2.0, -3.0, 4.0, -1.0]
    weekdays = [MONDAY, SATURDAY, MONDAY, TUESDAY := 1]
    result = weekday_errors(errors, weekdays, target_weekday=MONDAY)
    assert result == [2.0, 4.0]


def test_weekday_errors_no_match_returns_empty():
    result = weekday_errors([1.0, 2.0], [MONDAY, MONDAY], target_weekday=SATURDAY)
    assert result == []


def test_weekday_errors_all_match():
    errors   = [1.0, 2.0, 3.0]
    weekdays = [SATURDAY, SATURDAY, SATURDAY]
    assert weekday_errors(errors, weekdays, SATURDAY) == [1.0, 2.0, 3.0]


def test_weekday_errors_mismatched_lengths():
    with pytest.raises(ValueError):
        weekday_errors([1.0, 2.0], [MONDAY], target_weekday=MONDAY)


# ---------------------------------------------------------------------------
# Full ensemble pipeline
# ---------------------------------------------------------------------------

def test_ensemble_self_correcting_weights():
    """End-to-end: per-weekday errors → weights → blend → interval.

    Model A (seasonal-naive) has been accurate on Saturdays (low MAE).
    Model B (WMA) has been less accurate (higher MAE).
    The blend must be pulled toward Model A's prediction.
    """
    mae_a, mae_b = 5.0, 20.0          # A is 4× more accurate
    weights = model_weights([mae_a, mae_b])

    pred_a, pred_b = 110.0, 90.0
    forecast = blend([pred_a, pred_b], weights)

    # Better model has > 75% weight → forecast must exceed the simple average
    assert forecast > (pred_a + pred_b) / 2

    recent_errors = [3.0, -4.0, 6.0, -2.0]
    lo, hi = prediction_interval(forecast, recent_errors)
    assert lo < forecast < hi


def test_ensemble_per_weekday_filtering():
    """weekday_errors isolates the right subset, enabling per-weekday weighting."""
    all_errors = [1.0, 5.0, 2.0, 6.0, 3.0]      # alternating Mon/Sat
    all_days   = [MONDAY, SATURDAY, MONDAY, SATURDAY, MONDAY]

    sat_errors = weekday_errors(all_errors, all_days, SATURDAY)
    mon_errors = weekday_errors(all_errors, all_days, MONDAY)

    # Saturday errors should produce lower MAE and thus a different weight split
    # than Monday errors when the two models are compared
    assert sat_errors == [5.0, 6.0]
    assert mon_errors == [1.0, 2.0, 3.0]

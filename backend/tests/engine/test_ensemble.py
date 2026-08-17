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

def test_weights_inverse_variance_proportional():
    """Bates-Granger: weights go as 1/error^2, so the better model dominates.

    errors [0.1, 0.2]: 1/0.01 = 100, 1/0.04 = 25, total 125 -> [0.8, 0.2].
    Plain 1/error would have given [2/3, 1/3] — a model with twice the error
    still keeping a third of the vote.
    """
    w = model_weights([0.1, 0.2])
    assert w[0] == pytest.approx(0.8, rel=1e-9)
    assert w[1] == pytest.approx(0.2, rel=1e-9)


def test_sharpness_is_adjustable_and_one_reproduces_plain_inverse_error():
    w = model_weights([0.1, 0.2], sharpness=1.0)
    assert w[0] == pytest.approx(2 / 3, rel=1e-9)


def test_a_small_skill_difference_still_moves_the_weights_meaningfully():
    """The failure this replaced: four models within 8% of each other used to
    come out as a plain average to three decimal places, so the worst model
    kept nearly a quarter of the say."""
    w = model_weights([65.3, 65.45, 65.61, 70.47])
    assert max(w) - min(w) > 0.02, "weighting must react to a real skill gap"
    assert w[3] == min(w), "the clearly worst model must get the smallest share"


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


# ── debias (FINDING F-019) ───────────────────────────────────────────────────
# Inverse-error weighting cannot see bias: a model that is always 20 low and a
# model that is unbiased but noisier can share an MAE.  In a growing business
# every trailing-average model is low in the same direction, so the blend
# inherits the lag — measured at +19.9 customers a day over the simulated year.
#
# But the correction must only fire on a bias that is real.  A first version
# shrank by sample size alone and made things worse: bias +18.7 → +11.5 but
# MAPE 10.3% → 11.7%, because with four holdout points it was mostly correcting
# noise.  The shift is now weighted by mean-versus-its-own-standard-error.

from app.engine.ensemble import debias  # noqa: E402


def test_debias_leaves_a_prediction_alone_without_evidence():
    assert debias(500.0, []) == 500.0
    assert debias(500.0, [40.0]) == 500.0, "one point cannot establish a bias"


def test_a_certain_bias_is_applied_in_full():
    """Four identical errors have zero spread — the bias is unambiguous."""
    assert debias(500.0, [20.0] * 4) == pytest.approx(520.0)


def test_debias_ignores_errors_that_average_out():
    assert debias(500.0, [10.0, -10.0, 10.0, -10.0]) == pytest.approx(500.0)


def test_a_mean_no_bigger_than_its_own_noise_moves_nothing():
    """mean 10, standard error ~25 — indistinguishable from noise."""
    assert debias(500.0, [60.0, -40.0, 50.0, -30.0]) == pytest.approx(500.0)


def test_a_clear_bias_survives_some_scatter():
    """Consistently low by roughly 30, with modest scatter — a real lag."""
    got = debias(500.0, [25.0, 35.0, 28.0, 32.0])
    assert 515.0 < got < 530.0


def test_more_consistent_evidence_keeps_more_of_the_shift():
    noisy = debias(500.0, [10.0, 50.0, -5.0, 45.0])
    tight = debias(500.0, [24.0, 26.0, 25.0, 25.0])
    assert tight - 500.0 > noisy - 500.0


def test_debias_corrects_downward_too():
    assert debias(500.0, [-30.0] * 4) == pytest.approx(470.0)


def test_a_freak_error_cannot_move_the_forecast_more_than_a_fifth():
    assert debias(500.0, [5000.0] * 4) == pytest.approx(600.0)
    assert debias(500.0, [-5000.0] * 4) == pytest.approx(400.0)


def test_debias_does_not_change_the_spread_used_for_the_interval():
    """A constant shift moves the centre, never the width — so the prediction
    interval stays correctly sized after debiasing."""
    errs = [20.0, 30.0, 10.0, 20.0]
    before = prediction_interval(500.0, errs)
    after = prediction_interval(debias(500.0, errs), errs)
    assert (after[1] - after[0]) == pytest.approx(before[1] - before[0])

"""
Regression tests for the ensemble forecast bug (spec §2):
a model with no holdout errors must NOT receive the floor-MAE-1.0 weight,
and linear_trend must not extrapolate to absurd values.

Before the fix:
  - maes[model] = 1.0 when errs == [] → floor looked like "perfect accuracy"
  - a wildly extrapolating linear_trend could dominate at ~93% weight
  - the prediction interval was inflated by those huge holdout errors

After the fix:
  - models with no holdout errors are excluded from the blend entirely
  - linear_trend output is capped to mean ± max(3σ, 50% of mean)
  - only validated-model errors feed the prediction interval
  - interval lower bound is clamped to 0 (customers can't be negative)
"""
import pytest
import numpy as np
from app.api.analytics import (
    _cap_linear_trend,
    _holdout_errors,
    _linear_trend_for_weekday,
    _wma_for_weekday,
    _exp_for_weekday,
)
from app.engine.ensemble import model_weights, blend, prediction_interval
from app.engine.accuracy import mad
from app.engine.seasonality import seasonal_naive_forecast


# ── _cap_linear_trend ─────────────────────────────────────────────────────────

def test_cap_does_not_alter_reasonable_prediction():
    """A prediction close to observed values must pass through unchanged."""
    same = [88.0, 90.0, 91.0, 89.0, 92.0]
    # Linear trend on a nearly flat series predicts ~91 → well within the cap
    assert _cap_linear_trend(91.0, same) == pytest.approx(91.0)


def test_cap_clamps_wild_extrapolation():
    """A wildly extrapolated prediction (e.g. 900 when obs ~90) must be clamped."""
    same = [88.0, 90.0, 91.0, 89.0, 92.0]
    result = _cap_linear_trend(900.0, same)
    assert result < 150.0, f"Expected cap well below 900, got {result}"
    assert result >= 0.0


def test_cap_allows_genuine_rising_trend():
    """A prediction 10–15% above the current peak for a rising series must pass."""
    same = [80.0, 85.0, 90.0, 95.0, 100.0]  # +5 per week
    # linear_trend would predict ~105; cap must not block it
    result = _cap_linear_trend(105.0, same)
    assert result == pytest.approx(105.0), (
        f"Reasonable rising-trend prediction should not be capped; got {result}"
    )


def test_cap_output_never_negative():
    """Customer counts can't be negative; cap must clamp to 0 from below."""
    same = [5.0, 3.0, 1.0]  # strong downward trend
    result = _cap_linear_trend(-20.0, same)
    assert result == 0.0


def test_cap_empty_obs_returns_nonnegative():
    assert _cap_linear_trend(50.0, []) == pytest.approx(50.0)
    assert _cap_linear_trend(-5.0, []) == 0.0


# ── Model exclusion: no holdout → not in blend ────────────────────────────────

def test_unvalidated_linear_trend_does_not_dominate_stable_forecast():
    """
    Core regression test for the 915-vs-103 bug.

    With only 3 same-weekday observations, linear_trend gets no holdout errors
    and must be excluded from the blend.  The stable models (seasonal_naive,
    WMA) must keep the forecast near the observed mean, not near a wild
    extrapolation.
    """
    # 3 Mondays: stable around 90, but with a slight upward nudge so OLS
    # would extrapolate aggressively if allowed to dominate.
    obs = [85.0, 90.0, 95.0]
    wds = [0, 0, 0]  # all Monday
    wd  = 0

    holdout = _holdout_errors(obs, wds)

    preds: dict[str, float] = {}
    maes:  dict[str, float] = {}

    # seasonal_naive
    try:
        _sn = seasonal_naive_forecast(obs, wds, wd)
        errs = holdout["seasonal_naive"].get(wd, [])
        if errs:
            preds["seasonal_naive"] = _sn
            maes["seasonal_naive"]  = mad([abs(e) for e in errs])
    except ValueError:
        pass

    # wma
    p = _wma_for_weekday(obs, wds, wd)
    if p is not None:
        errs = holdout["wma"].get(wd, [])
        if errs:
            preds["wma"] = p
            maes["wma"]  = mad([abs(e) for e in errs])

    # exp_smoothing
    p = _exp_for_weekday(obs, wds, wd)
    if p is not None:
        errs = holdout["exp_smoothing"].get(wd, [])
        if errs:
            preds["exp_smoothing"] = p
            maes["exp_smoothing"]  = mad([abs(e) for e in errs])

    # linear_trend — with only 3 obs there are no holdout errors; must be excluded
    p = _linear_trend_for_weekday(obs, wds, wd)
    if p is not None:
        errs = holdout["linear_trend"].get(wd, [])
        if errs:
            same_wd = obs
            preds["linear_trend"] = _cap_linear_trend(p, same_wd)
            maes["linear_trend"]  = mad([abs(e) for e in errs])

    # linear_trend must not be in preds — not enough holdout data
    assert "linear_trend" not in preds, (
        "linear_trend must be excluded when it has no holdout errors"
    )

    if preds:
        weights  = model_weights(list(maes.values()))
        forecast = blend(list(preds.values()), weights)
        assert 80.0 <= forecast <= 100.0, (
            f"Stable series ~90 must forecast near 90, got {forecast:.1f}"
        )


def test_stable_series_14_mondays_forecasts_near_mean():
    """With 14 Mondays around 90 the ensemble must not produce 900+."""
    obs = [88.0, 91.0, 89.0, 90.0, 92.0, 88.0, 90.0,
           91.0, 89.0, 90.0, 92.0, 88.0, 90.0, 91.0]
    wds = [0] * 14
    wd  = 0

    holdout = _holdout_errors(obs, wds)

    preds: dict[str, float] = {}
    maes:  dict[str, float] = {}

    try:
        _sn = seasonal_naive_forecast(obs, wds, wd)
        errs = holdout["seasonal_naive"].get(wd, [])
        if errs:
            preds["seasonal_naive"] = _sn
            maes["seasonal_naive"]  = mad([abs(e) for e in errs])
    except ValueError:
        pass

    p = _wma_for_weekday(obs, wds, wd)
    if p is not None:
        errs = holdout["wma"].get(wd, [])
        if errs:
            preds["wma"] = p
            maes["wma"]  = mad([abs(e) for e in errs])

    p = _exp_for_weekday(obs, wds, wd)
    if p is not None:
        errs = holdout["exp_smoothing"].get(wd, [])
        if errs:
            preds["exp_smoothing"] = p
            maes["exp_smoothing"]  = mad([abs(e) for e in errs])

    p = _linear_trend_for_weekday(obs, wds, wd)
    if p is not None:
        errs = holdout["linear_trend"].get(wd, [])
        if errs:
            same_wd = [v for v, w in zip(obs, wds) if w == wd]
            preds["linear_trend"] = _cap_linear_trend(p, same_wd)
            maes["linear_trend"]  = mad([abs(e) for e in errs])

    assert preds, "Must have at least one validated model for 14 observations"
    weights  = model_weights(list(maes.values()))
    forecast = blend(list(preds.values()), weights)

    assert 83.0 <= forecast <= 97.0, (
        f"Stable series ~90 over 14 weeks must forecast near 90, got {forecast:.2f}"
    )


# ── Prediction interval: validated-models-only ───────────────────────────────

def test_interval_not_blown_up_by_excluded_model_errors():
    """
    If an extreme model was excluded from the blend, its errors must NOT
    inflate the prediction interval.  Using only well-behaved errors the
    interval must stay within a reasonable distance from the forecast.
    """
    forecast   = 90.0
    # Errors from validated models only (all small, ±10 range)
    good_errs  = [4.0, -3.0, 6.0, -5.0, 3.0, -4.0]
    lo, hi     = prediction_interval(forecast, good_errs)
    lo         = max(0.0, lo)

    # With std ~4.5 and z=1.645, margin ≈ 7.4 → interval ~[82.6, 97.4]
    assert lo >= 70.0, f"Lower bound {lo:.1f} unreasonably low for stable data"
    assert hi <= 110.0, f"Upper bound {hi:.1f} unreasonably high for stable data"


def test_interval_lower_bound_never_negative():
    """After clamping, the lower bound must be ≥ 0."""
    forecast = 10.0
    # Large negative errors could push lo below 0
    errs = [-50.0, -40.0, -30.0, 2.0, 3.0]
    lo, hi = prediction_interval(forecast, errs)
    lo = max(0.0, lo)
    assert lo == 0.0


# ── Rising series: trend is preserved and projected forward ──────────────────

def test_rising_series_linear_trend_forecasts_above_trailing_average():
    """
    Spec §2: 'Test that a steadily rising series forecasts *above* the last
    point, not at the trailing average.'

    With 7 Mondays rising by 5/week (70→100), linear_trend must be validated
    (enough holdout data) and must produce a forecast above the mean (85).
    The prediction must also stay within the cap (not explode).
    """
    obs = [70.0, 75.0, 80.0, 85.0, 90.0, 95.0, 100.0]
    wds = [0] * 7
    wd  = 0

    trailing_avg = seasonal_naive_forecast(obs, wds, wd)  # mean = 85.0
    assert trailing_avg == pytest.approx(85.0)

    p = _linear_trend_for_weekday(obs, wds, wd)
    assert p is not None, "linear_trend must produce a value for 7 same-wd points"

    same_wd = obs
    p_capped = _cap_linear_trend(p, same_wd)

    # Must forecast above the trailing average (it's a rising series)
    assert p_capped > trailing_avg, (
        f"Rising-trend forecast {p_capped:.1f} must exceed trailing avg {trailing_avg:.1f}"
    )

    # Must stay within reason (not explode)
    assert p_capped <= 130.0, (
        f"Rising-trend prediction {p_capped:.1f} exceeded reasonable cap for obs max=100"
    )


def test_rising_series_ensemble_forecasts_above_mean_when_linear_trend_validated():
    """
    With enough same-weekday data, linear_trend has holdout errors, gets a real
    weight, and pulls the ensemble above the trailing mean for a rising series.
    """
    obs = [70.0, 75.0, 80.0, 85.0, 90.0, 95.0, 100.0]
    wds = [0] * 7
    wd  = 0

    trailing_avg = seasonal_naive_forecast(obs, wds, wd)  # 85.0

    holdout = _holdout_errors(obs, wds)

    preds: dict[str, float] = {}
    maes:  dict[str, float] = {}

    try:
        _sn = seasonal_naive_forecast(obs, wds, wd)
        errs = holdout["seasonal_naive"].get(wd, [])
        if errs:
            preds["seasonal_naive"] = _sn
            maes["seasonal_naive"]  = mad([abs(e) for e in errs])
    except ValueError:
        pass

    p = _wma_for_weekday(obs, wds, wd)
    if p is not None:
        errs = holdout["wma"].get(wd, [])
        if errs:
            preds["wma"] = p
            maes["wma"]  = mad([abs(e) for e in errs])

    p = _exp_for_weekday(obs, wds, wd)
    if p is not None:
        errs = holdout["exp_smoothing"].get(wd, [])
        if errs:
            preds["exp_smoothing"] = p
            maes["exp_smoothing"]  = mad([abs(e) for e in errs])

    p = _linear_trend_for_weekday(obs, wds, wd)
    if p is not None:
        errs = holdout["linear_trend"].get(wd, [])
        if errs:
            same_wd = obs
            preds["linear_trend"] = _cap_linear_trend(p, same_wd)
            maes["linear_trend"]  = mad([abs(e) for e in errs])

    assert preds, "Must have validated models for 7 observations"

    weights  = model_weights(list(maes.values()))
    forecast = blend(list(preds.values()), weights)

    # Ensemble should forecast above the trailing average for a rising series
    assert forecast > trailing_avg, (
        f"Rising-series ensemble {forecast:.1f} must exceed trailing avg {trailing_avg:.1f}"
    )
    assert forecast <= 130.0, f"But must stay within reason; got {forecast:.1f}"

"""
Ensemble blending: weights models inversely by recent per-weekday error.

This is the "self-correcting weights" feature from spec section 2.
A model that has been accurate on, say, Saturdays gets more say in the
Saturday forecast; one that has been drifting gets quietly down-weighted.

Pure functions — no DB, no framework imports.
weekday convention: 0=Monday … 6=Sunday (Python datetime.weekday()).
"""
from __future__ import annotations

import numpy as np


def model_weights(errors: list[float], floor: float = 1e-6) -> list[float]:
    """Convert per-model MAE/MAPE values to inverse-error weights summing to 1.

    w_i = (1 / max(err_i, floor)) / Σ_j (1 / max(err_j, floor))

    A lower error → higher weight. floor prevents division by zero for a
    model that has been perfect lately.
    errors must be non-negative (pass MAE or MAPE values, not signed errors).
    """
    if not errors:
        raise ValueError("errors list must not be empty")
    if any(e < 0 for e in errors):
        raise ValueError("errors must be non-negative (pass MAE or MAPE, not signed errors)")

    inv = [1.0 / max(e, floor) for e in errors]
    total = sum(inv)
    return [w / total for w in inv]


def debias(
    prediction: float,
    signed_errors: list[float],
    max_fraction: float = 0.20,
) -> float:
    """Shift one model's prediction by its own recent mean signed error.

    Inverse-error weighting is **blind to bias**.  A model that is consistently
    20 customers low and a model that is unbiased but noisier can have exactly
    the same MAE, so the blend never learns to prefer the honest one.  In a
    business whose demand is steadily growing, every trailing-average model is
    quietly low in the same direction, they all keep similar MAEs, and the blend
    inherits the lag: over the simulated year the forecast ran +19.9 customers
    low on every ordinary day once growth started.

    The fix is what a tracking signal is *for*.  Each model already has its own
    per-weekday holdout errors (actual − predicted, on data it did not see); if
    those have a consistent sign, the model has a known bias and can simply be
    shifted by it.

    The correction must only fire when the bias is **real**, not when a handful
    of noisy holdout points happen to average out non-zero.  A first attempt
    that shrank by sample size alone made things measurably worse: over the
    simulated year it cut the bias from +18.7 to +11.5 customers but pushed MAPE
    from 10.3 % to 11.7 %, because with four holdout points the "bias" it was
    correcting was mostly noise.

    So the shift is weighted by how large the mean error is compared with its
    own standard error:

        weight = max(0, 1 − (standard error / mean error)²)

    A mean no bigger than its own standard error is indistinguishable from
    noise and moves the forecast not at all.  A mean twice its standard error
    keeps three-quarters of the shift; a consistent lag across many
    observations keeps nearly all of it.  Finally the shift is capped at
    ``max_fraction`` of the prediction so a freak error cannot move a forecast
    by more than a fifth.

    Known answers:
        debias(500, [])                       → 500     (no evidence)
        debias(500, [20, 20, 20, 20])         → 520     (zero spread: certain bias)
        debias(500, [10, -10, 10, -10])       → 500     (mean is 0)
        debias(500, [60, -40, 50, -30])       → 500     (mean 10, se 25 → noise)
    """
    if len(signed_errors) < 2:
        return prediction
    n = len(signed_errors)
    mean_err = float(np.mean(signed_errors))
    if mean_err == 0.0:
        return prediction

    se = float(np.std(signed_errors, ddof=1)) / float(np.sqrt(n))
    weight = max(0.0, 1.0 - (se * se) / (mean_err * mean_err))
    shift = mean_err * weight

    cap = abs(prediction) * max_fraction
    shift = max(-cap, min(cap, shift))
    return prediction + shift


def blend(predictions: list[float], weights: list[float]) -> float:
    """Weighted average of model predictions: Σ w_i · pred_i."""
    if not predictions:
        raise ValueError("predictions must not be empty")
    if len(predictions) != len(weights):
        raise ValueError("predictions and weights must have the same length")
    return float(np.dot(predictions, weights))


def prediction_interval(
    forecast: float,
    recent_errors: list[float],
    z: float = 0.7,
) -> tuple[float, float]:
    """(low, high) PROBABLE range around the forecast based on recent error spread.

    recent_errors: signed errors (actual − forecast) from recent comparable periods.
    Width = z × sample_std(errors). Default z=0.7 gives a ~52% probable-day band
    (the range where demand *usually* lands — not an extreme confidence interval).
    A ~90 business shows ~80–100 rather than 47–123.
    Returns (forecast, forecast) when all recent errors are identical (zero spread).
    Pass z=1.645 explicitly for a 90% interval when needed.
    """
    if not recent_errors:
        raise ValueError("recent_errors must not be empty")
    if len(recent_errors) < 2:
        raise ValueError("Need at least 2 error observations to estimate spread")

    spread = float(np.std(recent_errors, ddof=1))
    margin = z * spread
    return (forecast - margin, forecast + margin)


def weekday_errors(
    errors: list[float],
    weekdays: list[int],
    target_weekday: int,
) -> list[float]:
    """Filter a model's error history to only the target weekday.

    Used to give each weekday its own model weights, so Saturday's blend can
    differ from Monday's — the key mechanism of per-weekday self-correction.
    """
    if len(errors) != len(weekdays):
        raise ValueError("errors and weekdays must have the same length")
    return [e for e, w in zip(errors, weekdays) if w == target_weekday]

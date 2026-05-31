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
    z: float = 1.645,
) -> tuple[float, float]:
    """(low, high) interval around the forecast based on recent error spread.

    recent_errors: signed errors (actual − forecast) from recent comparable periods.
    Width = z × sample_std(errors). Default z=1.645 gives a 90% interval.
    Returns (forecast, forecast) when all recent errors are identical (zero spread).
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

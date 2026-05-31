"""
Forecasting models: SMA, WMA, exponential smoothing, linear trend, seasonality index.
Pure functions — no DB, no framework imports.
"""
from __future__ import annotations

import numpy as np
from scipy import stats


def simple_moving_average(values: list[float], n: int) -> float:
    """Mean of the last *n* observations."""
    if n < 1:
        raise ValueError("n must be >= 1")
    if len(values) < n:
        raise ValueError(f"Need at least {n} observations, got {len(values)}")
    return float(np.mean(values[-n:]))


def weighted_moving_average(values: list[float], weights: list[float]) -> float:
    """Weighted mean of the last len(weights) observations (oldest→newest).

    weights must sum to 1. The tail of *values* is used, so pass the full
    history and let the function slice the relevant window.
    """
    n = len(weights)
    if n == 0:
        raise ValueError("weights must not be empty")
    if len(values) < n:
        raise ValueError(f"Need at least {n} observations, got {len(values)}")
    w = np.asarray(weights, dtype=float)
    if not np.isclose(w.sum(), 1.0):
        raise ValueError("weights must sum to 1")
    window = np.asarray(values[-n:], dtype=float)
    return float(np.dot(window, w))


def exponential_smoothing(alpha: float, prev_forecast: float, actual: float) -> float:
    """Single exponential smoothing: F_{t+1} = α·A_t + (1−α)·F_t."""
    if not (0 < alpha < 1):
        raise ValueError("alpha must be strictly between 0 and 1")
    return alpha * actual + (1.0 - alpha) * prev_forecast


def linear_trend(xs: list[float], ys: list[float], t: float) -> float:
    """OLS fit of y = a + b·t and forecast at time *t*.

    xs and ys are parallel sequences of historical (time, value) pairs.
    Uses scipy.stats.linregress — do not hand-roll.
    """
    if len(xs) < 2:
        raise ValueError("Need at least 2 data points for linear regression")
    if len(xs) != len(ys):
        raise ValueError("xs and ys must have the same length")
    slope, intercept, *_ = stats.linregress(xs, ys)
    return float(intercept + slope * t)


def seasonality_index(day_average: float, overall_average: float) -> float:
    """Ratio of a given day-type's average to the overall average.

    Multiply a base forecast by this index to scale it for the day.
    """
    if overall_average == 0:
        raise ValueError("overall_average must be non-zero")
    return day_average / overall_average

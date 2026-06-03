"""
Forecast accuracy metrics: MAD, MSE, MAPE, tracking signal, coefficient of variation.
Pure functions — no DB, no framework imports.

All error lists use the sign convention: error = actual − forecast.
"""
from __future__ import annotations

import numpy as np


def forecast_errors(actuals: list[float], forecasts: list[float]) -> list[float]:
    """Element-wise actual − forecast."""
    if len(actuals) != len(forecasts):
        raise ValueError("actuals and forecasts must have the same length")
    return [float(a - f) for a, f in zip(actuals, forecasts)]


def mad(errors: list[float]) -> float:
    """Mean Absolute Deviation."""
    if not errors:
        raise ValueError("errors list is empty")
    return float(np.mean(np.abs(errors)))


def mse(errors: list[float]) -> float:
    """Mean Squared Error."""
    if not errors:
        raise ValueError("errors list is empty")
    return float(np.mean(np.square(errors)))


def mape(actuals: list[float], forecasts: list[float]) -> float:
    """Mean Absolute Percentage Error, returned as a percentage (e.g. 10.0 for 10%).

    Pairs where actual == 0 are excluded (closed days / zero demand).
    Raises if no valid pairs remain.
    """
    if len(actuals) != len(forecasts):
        raise ValueError("actuals and forecasts must have the same length")
    terms = [
        abs(a - f) / a
        for a, f in zip(actuals, forecasts)
        if a != 0
    ]
    if not terms:
        raise ValueError("No valid (non-zero actual) pairs to compute MAPE")
    return float(np.mean(terms) * 100)


def tracking_signal(errors: list[float]) -> float:
    """Running Sum of Forecast Errors divided by MAD (RSFE / MAD).

    Values outside roughly ±4 indicate a biased model needing recalibration.
    """
    if not errors:
        raise ValueError("errors list is empty")
    rsfe = sum(errors)
    return rsfe / mad(errors)


def coefficient_of_variation(values: list[float]) -> float:
    """Sample std dev / mean — measures how predictable demand is (lower = more stable)."""
    if not values:
        raise ValueError("values list is empty")
    mean = float(np.mean(values))
    if mean == 0:
        raise ValueError("mean is zero, CV is undefined")
    return float(np.std(values, ddof=1) / mean)


def detect_drift(
    values: list[float],
    window: int = 21,
    threshold_pct: float = 10.0,
) -> str | None:
    """Detect sustained demand drift between recent and prior observations.

    Compares mean(values[-window:]) to mean(values[:-window]).
    Returns a plain-language alert string when the recent mean deviates by
    more than threshold_pct from the prior baseline, else None.
    Requires at least 2 * window observations; returns None otherwise.
    """
    if len(values) < 2 * window:
        return None

    prior = values[:-window]
    recent = values[-window:]

    prior_mean = float(np.mean(prior))
    if prior_mean == 0:
        return None

    recent_mean = float(np.mean(recent))
    pct_change = (recent_mean - prior_mean) / prior_mean * 100.0

    if abs(pct_change) < threshold_pct:
        return None

    direction = "higher" if pct_change > 0 else "lower"
    abs_pct = round(abs(pct_change), 1)
    n_weeks = window // 7
    week_str = f"{n_weeks} week{'s' if n_weeks != 1 else ''}"
    return (
        f"Your demand has been ~{abs_pct}% {direction} than usual over the last "
        f"{week_str}. This may be a real shift — check if anything has changed."
    )

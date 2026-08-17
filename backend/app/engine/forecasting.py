"""
Forecasting models: SMA, WMA, exponential smoothing, linear trend, seasonality index,
same-date-last-year.
Pure functions — no DB, no framework imports.
"""
from __future__ import annotations

from datetime import date, timedelta

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


MIN_EARLY_OBSERVATIONS = 2


def early_forecast(
    observations: list[float],
    weekdays: list[int],
    target_weekday: int,
) -> tuple[float, float] | None:
    """A deliberately humble forecast for a business with only days of history.

    The mature ensemble needs weeks of same-weekday history before it means
    anything.  Before that, an owner should still see *something* — but framed
    as a range they can plan around, not a confident single number.

    Method (nothing clever, and nothing that pretends to know more than it does):

    * With no same-weekday history yet, the estimate is simply the average of
      every day logged so far.
    * With some same-weekday history, the same-weekday average is **shrunk
      toward** that overall average, with weight ``k / (k + 1)`` for ``k``
      same-weekday observations.  One Sunday is not evidence that every Sunday
      looks like it; four Sundays mostly are.  This is ordinary shrinkage, and it
      stops a single quiet opening day from anchoring a whole weekday.
    * The band is the spread of everything logged so far, widened by the
      small-sample factor ``sqrt(1 + 1/n)`` and taken at z = 1.0 — noticeably
      wider than the mature ±0.7σ band, because the uncertainty really is larger.
      With too few points to estimate spread, ±25 % is used so the range is never
      shown as a falsely precise single value.

    Returns ``(low, high)``, or ``None`` when there is not even enough data for
    this.  The caller supplies the point estimate as the midpoint.
    """
    if len(observations) != len(weekdays):
        raise ValueError("observations and weekdays must have the same length")
    n = len(observations)
    if n < MIN_EARLY_OBSERVATIONS:
        return None

    overall = float(np.mean(observations))
    same_wd = [v for v, w in zip(observations, weekdays) if w == target_weekday]
    if same_wd:
        k = len(same_wd)
        weight = k / (k + 1.0)
        point = weight * float(np.mean(same_wd)) + (1.0 - weight) * overall
    else:
        point = overall

    if n >= 2:
        spread = float(np.std(observations, ddof=1)) * float(np.sqrt(1.0 + 1.0 / n))
    else:
        spread = 0.0
    if spread <= 0:
        spread = abs(point) * 0.25

    return (max(0.0, point - spread), point + spread)


def year_over_year_forecast(
    dates: list[date],
    values: list[float],
    target_date: date,
    same_wd_window: int = 7,
    level_window: int = 21,
) -> float | None:
    """Year-over-year prediction combining two long-range signals.

    Signal 1 (same-weekday, narrow window): average of same-weekday observations
    within ±same_wd_window days of the same calendar date one year ago.  Preserves
    the day-of-week character — this Sunday vs Sundays around the same time last year.

    Signal 2 (surrounding level, wider window): average of ALL observations
    (any weekday) within ±level_window days of the same calendar date one year ago.
    Captures the general demand level around that time last year, regardless of weekday.

    Returns the mean of whichever signals have data, or None when no year-ago
    observations fall within either window.  None is the no-data guard: the
    holdout-accuracy weighting in the ensemble naturally gives this model zero weight
    when it cannot make a prediction.
    """
    if len(dates) != len(values):
        raise ValueError("dates and values must have the same length")
    if not dates:
        return None

    try:
        anchor = target_date.replace(year=target_date.year - 1)
    except ValueError:
        anchor = target_date.replace(year=target_date.year - 1, day=28)

    target_wd = target_date.weekday()

    s1_low = anchor - timedelta(days=same_wd_window)
    s1_high = anchor + timedelta(days=same_wd_window)
    s1_vals = [
        v for d, v in zip(dates, values)
        if s1_low <= d <= s1_high and d.weekday() == target_wd
    ]
    s1 = float(sum(s1_vals) / len(s1_vals)) if s1_vals else None

    s2_low = anchor - timedelta(days=level_window)
    s2_high = anchor + timedelta(days=level_window)
    s2_vals = [v for d, v in zip(dates, values) if s2_low <= d <= s2_high]
    s2 = float(sum(s2_vals) / len(s2_vals)) if s2_vals else None

    signals = [s for s in (s1, s2) if s is not None]
    return float(sum(signals) / len(signals)) if signals else None


def same_date_last_year(
    dates: list[date],
    values: list[float],
    target_date: date,
    window_days: int = 7,
) -> float | None:
    """Average of same-weekday observations within ±window_days of the same calendar date one year ago.

    Only observations that fall on the same weekday as target_date are included,
    so the day-of-week signal is preserved while adding yearly seasonality.

    Returns None when no matching observations exist (data doesn't span a full year
    or no same-weekday values fall within the window).
    """
    if len(dates) != len(values):
        raise ValueError("dates and values must have the same length")
    if not dates:
        return None

    try:
        anchor = target_date.replace(year=target_date.year - 1)
    except ValueError:
        # Feb 29 in a non-leap prior year — shift to Feb 28
        anchor = target_date.replace(year=target_date.year - 1, day=28)

    low = anchor - timedelta(days=window_days)
    high = anchor + timedelta(days=window_days)
    target_wd = target_date.weekday()

    matching = [
        v for d, v in zip(dates, values)
        if low <= d <= high and d.weekday() == target_wd
    ]
    return float(sum(matching) / len(matching)) if matching else None

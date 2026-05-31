"""
Seasonality index computation and seasonal-naive forecasting.
Pure functions — no DB, no framework imports.

weekday convention throughout: 0=Monday … 6=Sunday (Python datetime.weekday()).
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np


def compute_weekday_indices(
    observations: list[float],
    weekdays: list[int],
) -> dict[int, float]:
    """Compute a seasonality index for every weekday present in the data.

    index_d = avg(day d) / overall_avg

    Days with zero demand are excluded — they represent closed days and would
    unfairly suppress the overall average.

    Returns a dict mapping weekday → index. Only weekdays that appear in the
    (non-zero) data are included.
    """
    if len(observations) != len(weekdays):
        raise ValueError("observations and weekdays must have the same length")

    valid = [(v, w) for v, w in zip(observations, weekdays) if v != 0]
    if not valid:
        raise ValueError("No non-zero observations to compute seasonality indices")

    values, wdays = zip(*valid)
    overall_avg = float(np.mean(values))

    by_weekday: dict[int, list[float]] = defaultdict(list)
    for v, w in zip(values, wdays):
        by_weekday[w].append(v)

    return {wd: float(np.mean(vals)) / overall_avg for wd, vals in by_weekday.items()}


def seasonal_naive_forecast(
    observations: list[float],
    weekdays: list[int],
    target_weekday: int,
    n: int | None = None,
) -> float:
    """Average of the most recent *n* observations for *target_weekday*.

    This is one of the base models that feeds into the ensemble.
    If n is None, all matching observations are used.
    The caller is responsible for passing pre-cleaned data (event/ad periods
    already excluded).
    """
    if len(observations) != len(weekdays):
        raise ValueError("observations and weekdays must have the same length")

    matching = [v for v, w in zip(observations, weekdays) if w == target_weekday]
    if not matching:
        raise ValueError(f"No observations found for weekday {target_weekday}")

    window = matching if n is None else matching[-n:]
    if not window:
        raise ValueError(
            f"Need at least {n} observations for weekday {target_weekday}, "
            f"got {len(matching)}"
        )

    return float(np.mean(window))

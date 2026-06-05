"""
Outlier detection for daily customer counts.

Uses IQR (Tukey fences) per weekday: flags only below Q1 − 1.5·IQR or
above Q3 + 1.5·IQR.  This is the standard robust method and will not fire
on ordinary day-to-day variation.

Pure functions — no DB, no framework imports.
weekday convention: 0=Monday … 6=Sunday (Python datetime.weekday()).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Minimum same-weekday observations before we're willing to flag anything.
MIN_SAME_WEEKDAY = 4


@dataclass
class OutlierResult:
    day_index: int        # index into the input observation / weekday lists
    weekday: int          # 0=Mon … 6=Sun
    value: float          # the flagged customer count
    weekday_median: float # median of all other same-weekday values (leave-one-out)
    weekday_iqr: float    # IQR of the same reference set
    direction: str        # 'high' or 'low'


def detect_outliers(
    observations: list[float],
    weekdays: list[int],
) -> list[OutlierResult]:
    """Flag days outside Tukey fences (Q1 − 1.5·IQR, Q3 + 1.5·IQR) per weekday.

    Rules:
    - Requires MIN_SAME_WEEKDAY observations for a weekday before flagging any.
    - Uses leave-one-out: the candidate day is excluded from its own reference set.
    - If IQR of the reference set is zero (perfectly uniform history), falls back
      to a proportional floor (10% of median, min 1) so that genuine extremes
      (e.g. 1500 vs a constant 100) are still detectable.
    """
    if len(observations) != len(weekdays):
        raise ValueError("observations and weekdays must have the same length")

    by_wd: dict[int, list[int]] = {}
    for i, wd in enumerate(weekdays):
        by_wd.setdefault(wd, []).append(i)

    results: list[OutlierResult] = []

    for wd, indices in by_wd.items():
        if len(indices) < MIN_SAME_WEEKDAY:
            continue

        for i in indices:
            ref = np.array(
                [observations[j] for j in indices if j != i], dtype=float
            )
            if len(ref) < MIN_SAME_WEEKDAY - 1:
                continue

            q1 = float(np.percentile(ref, 25))
            q3 = float(np.percentile(ref, 75))
            iqr = q3 - q1
            median = float(np.median(ref))

            if iqr == 0.0:
                iqr = max(1.0, abs(median) * 0.10)

            lower = q1 - 1.5 * iqr
            upper = q3 + 1.5 * iqr

            value = observations[i]
            if value < lower or value > upper:
                results.append(OutlierResult(
                    day_index=i,
                    weekday=wd,
                    value=value,
                    weekday_median=round(median, 1),
                    weekday_iqr=round(iqr, 2),
                    direction="high" if value > upper else "low",
                ))

    return results


def weekday_median(
    observations: list[float],
    weekdays: list[int],
    target_weekday: int,
) -> float:
    """Median of all observations for target_weekday.

    Used to substitute for flagged outlier values when building the
    observation series for forecasting (down-weighting without discarding).
    """
    vals = [v for v, w in zip(observations, weekdays) if w == target_weekday]
    if not vals:
        raise ValueError(f"No observations for weekday {target_weekday}")
    return float(np.median(vals))

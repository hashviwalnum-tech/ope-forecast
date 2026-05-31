"""
Outlier detection for daily customer counts.

Uses median ± k·MAD per weekday — robust to a handful of anomalies in the
reference set, and automatically scales to the business's own volume.

Pure functions — no DB, no framework imports.
weekday convention: 0=Monday … 6=Sunday (Python datetime.weekday()).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Minimum same-weekday observations before we're willing to flag anything.
# Below this threshold we can't distinguish signal from noise.
MIN_SAME_WEEKDAY = 4


@dataclass
class OutlierResult:
    day_index: int        # index into the input observation / weekday lists
    weekday: int          # 0=Mon … 6=Sun
    value: float          # the flagged customer count
    weekday_median: float # median of all other same-weekday values (leave-one-out)
    weekday_mad: float    # MAD of the same reference set
    direction: str        # 'high' or 'low'
    k: float              # threshold multiplier used


def detect_outliers(
    observations: list[float],
    weekdays: list[int],
    k: float = 3.5,
) -> list[OutlierResult]:
    """Flag days whose customer count is more than k·MAD from the weekday median.

    k=3.5 approximates ~3σ (since σ ≈ 1.4826·MAD for normal data).

    Rules:
    - Requires MIN_SAME_WEEKDAY observations for a weekday before flagging any of them.
    - Uses leave-one-out: the candidate day is excluded from its own reference set.
    - If MAD of the reference set is zero, falls back to std dev; if that is also
      zero (perfectly uniform reference), a proportional floor (10% of median, min 1)
      is used so extreme deviations are still detectable.
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

            median = float(np.median(ref))
            mad = float(np.median(np.abs(ref - median)))

            # Fall back to std dev when all reference values are identical
            if mad == 0.0:
                mad = float(np.std(ref, ddof=1)) if len(ref) > 1 else 0.0
            # If still zero (perfectly uniform reference), use a proportional floor
            # so that extreme deviations (e.g. 9999 vs a constant 100) are still caught.
            if mad == 0.0:
                mad = max(1.0, abs(median) * 0.10)

            value = observations[i]
            if abs(value - median) > k * mad:
                results.append(OutlierResult(
                    day_index=i,
                    weekday=wd,
                    value=value,
                    weekday_median=round(median, 1),
                    weekday_mad=round(mad, 1),
                    direction="high" if value > median else "low",
                    k=k,
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

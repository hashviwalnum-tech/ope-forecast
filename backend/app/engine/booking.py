"""Booking-aware demand: blend owner-recorded booked-appointment counts into
the statistical forecast for appointment businesses (barbers, spas, clinics).

Key modelling truth (spec): booked load is a FLOOR, not the whole demand —
some customers walk in unscheduled, and not every booking shows up. So the
predicted total for a day is:

    predicted_total = slope * booked_count + intercept

where `slope` is the fitted effective show-up rate for booked appointments
(1 - no_show_rate) and `intercept` is the average number of walk-ins not
covered by any booking. Both are learned from this business's own history
via least-squares regression (per CLAUDE.md: use numpy/scipy, never
hand-roll) — never hand-coded — so the model only earns influence once it
has proven itself, via the same holdout-MAE weighting as every other
ensemble model (spec §2).
"""
from __future__ import annotations

import numpy as np

# Thin-data guard: same spirit as the year_over_year / linear_trend guards —
# refuse to fit on too few points rather than let a noisy fit dominate.
MIN_BOOKING_PAIRS = 5

# Sanity bounds on the fitted slope/intercept so a wild fit on noisy data
# can't blow up the forecast (mirrors the linear_trend clamp guard).
_MAX_SLOPE = 1.5


def fit_booking_regression(bookings: list[float], actuals: list[float]) -> tuple[float, float] | None:
    """Least-squares fit of actual = slope*booked + intercept.

    Returns (slope, intercept), or None when there are fewer than
    MIN_BOOKING_PAIRS paired observations. slope is clipped to [0, 1.5] and
    intercept is floored at 0.
    """
    if len(bookings) != len(actuals) or len(bookings) < MIN_BOOKING_PAIRS:
        return None
    slope, intercept = np.polyfit(bookings, actuals, 1)
    slope = max(0.0, min(_MAX_SLOPE, float(slope)))
    intercept = max(0.0, float(intercept))
    return slope, intercept


def booking_forecast(booked_count: float, slope: float, intercept: float) -> float:
    """Predicted total demand for a day given its booked-appointment count."""
    return max(0.0, slope * booked_count + intercept)


def no_show_rate_from_slope(slope: float) -> float:
    """Plain-language no-show rate implied by the fitted show-rate slope."""
    return max(0.0, min(1.0, 1.0 - slope))

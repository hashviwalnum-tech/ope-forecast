"""
Known-answer tests for engine/booking.py — booking-aware demand blending
for appointment businesses (spec: "booking-aware demand" feature).
"""
import pytest
from app.engine.booking import (
    booking_forecast,
    fit_booking_regression,
    no_show_rate_from_slope,
)


# ---------------------------------------------------------------------------
# fit_booking_regression
# ---------------------------------------------------------------------------

def test_fit_booking_regression_known_answer():
    # Perfect line actual = 1.0*booked + 5.0
    bookings = [10, 20, 30, 40, 50]
    actuals = [15, 25, 35, 45, 55]
    slope, intercept = fit_booking_regression(bookings, actuals)
    assert slope == pytest.approx(1.0)
    assert intercept == pytest.approx(5.0)


def test_fit_booking_regression_thin_data_returns_none():
    # Fewer than MIN_BOOKING_PAIRS (5) points — refuse to fit
    assert fit_booking_regression([10, 20, 30, 40], [15, 25, 35, 45]) is None


def test_fit_booking_regression_mismatched_lengths_returns_none():
    assert fit_booking_regression([10, 20, 30], [15, 25]) is None


def test_fit_booking_regression_slope_clipped_to_sane_range():
    # Raw fit here is slope≈9.8 — must be clamped to the 1.5 ceiling
    bookings = [1, 2, 3, 4, 5]
    actuals = [1, 10, 20, 30, 40]
    slope, _ = fit_booking_regression(bookings, actuals)
    assert slope == pytest.approx(1.5)


def test_fit_booking_regression_intercept_floored_at_zero():
    # Raw fit here is intercept≈-4 — must be floored to 0
    bookings = [10, 20, 30, 40, 50]
    actuals = [2, 8, 14, 20, 26]
    _, intercept = fit_booking_regression(bookings, actuals)
    assert intercept == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# booking_forecast
# ---------------------------------------------------------------------------

def test_booking_forecast_known_answer():
    assert booking_forecast(50, slope=1.0, intercept=5.0) == pytest.approx(55.0)


def test_booking_forecast_never_negative():
    assert booking_forecast(0, slope=1.0, intercept=-10.0) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# no_show_rate_from_slope
# ---------------------------------------------------------------------------

def test_no_show_rate_from_slope_known_answer():
    assert no_show_rate_from_slope(0.8) == pytest.approx(0.2)


def test_no_show_rate_from_slope_clipped_to_zero_above_full_showup():
    # A slope > 1 (more actual attendees per booking than booked, e.g. plus-ones)
    # implies a "negative" no-show rate — clip at 0, never report a negative rate.
    assert no_show_rate_from_slope(1.2) == pytest.approx(0.0)


def test_no_show_rate_from_slope_clipped_to_one_at_zero_showup():
    assert no_show_rate_from_slope(-0.5) == pytest.approx(1.0)

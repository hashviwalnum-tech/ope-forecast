"""
Known-answer tests for engine.forecasting.early_forecast.

The early forecast exists so a brand-new owner is not told "not enough data" on
every screen for a fortnight.  Its job is to be *honest*: a range, never a
confident point, and it must shrink a single day's weekday reading toward the
overall average rather than treating it as the truth about that weekday.
"""
import pytest

from app.engine.forecasting import MIN_EARLY_OBSERVATIONS, early_forecast


def mid(band):
    return (band[0] + band[1]) / 2


def test_needs_at_least_two_days():
    assert early_forecast([100.0], [0], 0) is None
    assert early_forecast([], [], 0) is None
    assert early_forecast([100.0, 120.0], [0, 1], 2) is not None
    assert MIN_EARLY_OBSERVATIONS == 2


def test_no_same_weekday_history_uses_the_overall_average():
    """Known answer: mean([100, 200, 300]) = 200 for an unseen weekday."""
    band = early_forecast([100.0, 200.0, 300.0], [0, 1, 2], target_weekday=4)
    assert mid(band) == pytest.approx(200.0)


def test_one_same_weekday_reading_is_shrunk_toward_the_overall_average():
    """Known answer, one Sunday of 40 among [40, 100, 100] (overall 80):

        k = 1  →  weight = 1/2
        point = 0.5*40 + 0.5*80 = 60

    A single quiet opening Sunday must NOT anchor every future Sunday at 40.
    """
    band = early_forecast([40.0, 100.0, 100.0], [6, 0, 1], target_weekday=6)
    assert mid(band) == pytest.approx(60.0)


def test_more_same_weekday_readings_shrink_less():
    """Three Sundays at 40 among [40,40,40,100,100] (overall 64):

        k = 3  →  weight = 3/4
        point = 0.75*40 + 0.25*64 = 46.0
    """
    band = early_forecast([40.0, 40.0, 40.0, 100.0, 100.0], [6, 6, 6, 0, 1], 6)
    assert mid(band) == pytest.approx(46.0)


def test_shrinkage_converges_on_the_weekday_average_with_more_data():
    obs = [40.0] * 10 + [100.0, 100.0]
    wds = [6] * 10 + [0, 1]
    assert mid(early_forecast(obs, wds, 6)) == pytest.approx(
        (10 / 11) * 40.0 + (1 / 11) * (sum(obs) / len(obs))
    )


def test_the_band_is_a_real_range_not_a_point():
    lo, hi = early_forecast([80.0, 100.0, 120.0], [0, 1, 2], 3)
    assert hi > lo
    assert lo >= 0


def test_band_is_wider_than_the_mature_band_would_be():
    """z = 1.0 plus a small-sample widening, against the mature z = 0.7."""
    obs = [80.0, 100.0, 120.0, 90.0, 110.0]
    lo, hi = early_forecast(obs, [0, 1, 2, 3, 4], 5)
    import statistics
    mature_half_width = 0.7 * statistics.stdev(obs)
    assert (hi - lo) / 2 > mature_half_width


def test_identical_history_still_produces_a_range():
    """Zero spread must not be reported as a falsely precise single number."""
    lo, hi = early_forecast([100.0, 100.0, 100.0], [0, 1, 2], 3)
    assert lo == pytest.approx(75.0)
    assert hi == pytest.approx(125.0)


def test_low_end_never_goes_negative():
    lo, _ = early_forecast([2.0, 3.0, 40.0], [0, 1, 2], 3)
    assert lo >= 0.0


def test_mismatched_lengths_raise():
    with pytest.raises(ValueError, match="same length"):
        early_forecast([1.0, 2.0], [0], 0)

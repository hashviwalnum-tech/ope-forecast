"""
Known-answer tests for engine.promo_uplift.

Context (FINDING F-017): tagged ad/event days are excluded from the training
baseline, but nothing added the uplift back when forecasting a day the owner had
already told us a promotion was running on.  Over a simulated year the forecast
was low on *every* promo day — bias +112 customers, tracking signal 8.0 — so the
ordering advice was too small exactly when the shop was busiest.
"""
import pytest

from app.engine.promo_uplift import (
    MAX_RATIO,
    MIN_RATIO,
    clamp_ratio,
    learned_uplift,
    uplift_for_day,
)


# ── learned_uplift ───────────────────────────────────────────────────────────

def test_no_history_means_no_adjustment():
    """The critical degradation guard: a business that has never run a promo
    gets exactly the forecast it got before this feature existed."""
    assert learned_uplift([]) == 1.0


def test_one_past_promotion_is_shrunk_halfway():
    """(1.20 + 1.0) / (1 + 1) = 1.10 — one promotion is weak evidence."""
    assert learned_uplift([1.20]) == pytest.approx(1.10)


def test_four_consistent_promotions_converge_on_the_observed_uplift():
    """(1.20*4 + 1.0) / (4 + 1) = 1.16"""
    assert learned_uplift([1.20] * 4) == pytest.approx(1.16)


def test_many_promotions_converge_further():
    assert learned_uplift([1.20] * 19) == pytest.approx((1.20 * 19 + 1) / 20)


def test_a_promotion_that_did_nothing_pulls_the_uplift_to_one():
    assert learned_uplift([1.0, 1.0, 1.0]) == pytest.approx(1.0)


def test_a_promotion_that_backfired_lowers_the_forecast():
    """(0.80 + 1.0)/2 = 0.90 — an honest model can predict a promo went badly."""
    assert learned_uplift([0.80]) == pytest.approx(0.90)


def test_a_freak_ratio_cannot_dominate():
    """A 12x ratio (bad baseline, tiny history) is clamped to 2.0 before use."""
    assert clamp_ratio(12.0) == MAX_RATIO
    assert clamp_ratio(0.01) == MIN_RATIO
    assert learned_uplift([12.0]) == pytest.approx(1.5)   # (2.0 + 1.0)/2


def test_non_positive_ratios_are_ignored():
    assert learned_uplift([0.0, -3.0]) == 1.0
    assert learned_uplift([0.0, 1.20]) == pytest.approx(1.10)


# ── uplift_for_day ───────────────────────────────────────────────────────────

def test_a_day_with_no_promotion_is_untouched():
    assert uplift_for_day({"ad": [1.5]}, []) == 1.0


def test_uses_the_history_of_the_matching_promo_type():
    ratios = {"ad": [1.20] * 4, "event": [1.60] * 4}
    assert uplift_for_day(ratios, ["ad"]) == pytest.approx(1.16)
    assert uplift_for_day(ratios, ["event"]) == pytest.approx(1.48)


def test_overlapping_ad_and_event_take_the_larger_not_the_product():
    """1.16 and 1.48 must give 1.48, never 1.16*1.48 = 1.72.

    An ad running inside an event reaches largely the same customers; stacking
    the two multiplicatively would produce an absurd forecast.
    """
    ratios = {"ad": [1.20] * 4, "event": [1.60] * 4}
    assert uplift_for_day(ratios, ["ad", "event"]) == pytest.approx(1.48)


def test_a_promo_type_with_no_history_contributes_nothing():
    assert uplift_for_day({"ad": []}, ["ad"]) == 1.0
    assert uplift_for_day({"event": [1.60] * 4}, ["ad", "event"]) == pytest.approx(1.48)

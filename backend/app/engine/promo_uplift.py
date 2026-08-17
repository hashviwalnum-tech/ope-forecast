"""
How much busier a tagged ad or event day is expected to be.

Ads and event days are (correctly) excluded from the *training* baseline, so the
models learn what a normal day looks like.  But nothing was putting the uplift
back when forecasting a day the owner had **already told us** an ad is running
on.  The result: on every promo day in the year-long simulation, Ope forecast
too low — by an average of 112 customers, with a tracking signal of 8.0 — and
therefore recommended ordering too little on exactly the days the shop was
busiest.

This module learns the uplift from the business's **own completed promotions**:
the same actual-vs-baseline ratio the Lift screen already shows the owner.

Pure functions — no DB, no framework imports.
"""
from __future__ import annotations

# A single freak promotion must never be allowed to dominate the forecast, the
# same anti-domination guard applied to the linear-trend model.
MIN_RATIO = 0.5
MAX_RATIO = 2.0

# Strength of the "assume no uplift" prior, measured in equivalent periods.
# With no history the uplift is exactly 1.0 (behave as before); with one past
# promotion it is halfway between 1.0 and what that promotion actually did; it
# converges on the true average as the owner runs more of them.
PRIOR_WEIGHT = 1.0


def clamp_ratio(ratio: float) -> float:
    return max(MIN_RATIO, min(MAX_RATIO, ratio))


def learned_uplift(past_ratios: list[float], prior_weight: float = PRIOR_WEIGHT) -> float:
    """Shrunk average uplift from completed promotions.  1.0 means no change.

    ``past_ratios`` are actual ÷ baseline for each finished promotion of the
    relevant kind.  Shrinkage toward 1.0 is what stops the very first promotion
    a business ever runs from being treated as gospel:

        uplift = (Σ ratios + prior_weight) / (n + prior_weight)

    Known answers:
        []                 → 1.00   (no history: forecast is untouched)
        [1.20]             → 1.10   (halfway; one promotion is weak evidence)
        [1.20]×4           → 1.16   (converging on the observed 1.20)
    """
    usable = [clamp_ratio(r) for r in past_ratios if r > 0]
    if not usable:
        return 1.0
    return (sum(usable) + prior_weight) / (len(usable) + prior_weight)


def uplift_for_day(
    ratios_by_type: dict[str, list[float]],
    active_types: list[str],
    prior_weight: float = PRIOR_WEIGHT,
) -> float:
    """Uplift to apply to one forecast day, given which promo types run on it.

    When an ad and an event overlap, the uplifts are **not** multiplied — that
    would double-count.  A second promotion running at the same time mostly
    reaches the same customers, so the larger of the two is used: the honest
    conservative choice, and it keeps an overlapping pair from producing an
    absurd forecast.
    """
    if not active_types:
        return 1.0
    return max(
        (learned_uplift(ratios_by_type.get(t, []), prior_weight) for t in active_types),
        default=1.0,
    )

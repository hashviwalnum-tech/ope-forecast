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


# How much same-weekday promo history is needed before the weekday-specific
# uplift outweighs the pooled one.  Expressed in equivalent observations.
WEEKDAY_PRIOR_WEIGHT = 3.0


def weekday_uplift(
    all_ratios: list[float],
    same_weekday_ratios: list[float],
    prior_weight: float = PRIOR_WEIGHT,
    weekday_prior_weight: float = WEEKDAY_PRIOR_WEIGHT,
) -> float:
    """Uplift for one weekday, shrunk toward the business's overall uplift.

    A single pooled figure is wrong whenever a promotion lifts different days by
    different amounts — which is normal, because a promotion mostly rescues the
    *quiet* days.  In the simulated restaurant a promo lifted an ordinary
    weekday by about 14 % but a Sunday by nearly 50 %, and the pooled uplift left
    Sunday promo days under-forecast by 152 customers apiece (MAPE 24.9 %).

    Two levels of shrinkage, the same "earn your weight" idea used everywhere
    else: the weekday figure is pulled toward the pooled figure, and the pooled
    figure is pulled toward 1.0.  With no same-weekday promo history this is
    exactly the pooled uplift; with plenty it converges on the weekday's own.
    """
    pooled = learned_uplift(all_ratios, prior_weight)
    usable = [clamp_ratio(r) for r in same_weekday_ratios if r > 0]
    if not usable:
        return pooled
    n = len(usable)
    return (sum(usable) + weekday_prior_weight * pooled) / (n + weekday_prior_weight)


def uplift_for_day(
    ratios_by_type: dict[str, list[float]],
    active_types: list[str],
    prior_weight: float = PRIOR_WEIGHT,
    ratios_by_type_weekday: dict[tuple[str, int], list[float]] | None = None,
    weekday: int | None = None,
) -> float:
    """Uplift to apply to one forecast day, given which promo types run on it.

    When an ad and an event overlap, the uplifts are **not** multiplied — that
    would double-count.  A second promotion running at the same time mostly
    reaches the same customers, so the larger of the two is used: the honest
    conservative choice, and it keeps an overlapping pair from producing an
    absurd forecast.

    When same-weekday promo history is supplied, each type's uplift is the
    weekday-specific one (shrunk toward that type's pooled figure).
    """
    if not active_types:
        return 1.0

    def _for(t: str) -> float:
        pool = ratios_by_type.get(t, [])
        if ratios_by_type_weekday is not None and weekday is not None:
            return weekday_uplift(pool, ratios_by_type_weekday.get((t, weekday), []),
                                  prior_weight)
        return learned_uplift(pool, prior_weight)

    return max((_for(t) for t in active_types), default=1.0)

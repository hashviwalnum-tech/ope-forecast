"""
Pure nudge-computation logic — no DB, no framework.

Inputs: already-computed forecast and ordering data.
Output: a list of Nudge objects sorted by priority.

Only the top nudge (the ONE thing worth acting on) is surfaced
in the API layer; computing all candidates lets the caller decide.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Nudge:
    type: str      # 'busy_tomorrow' | 'slow_tomorrow' | 'low_stock' | 'approaching_stock'
    message: str   # plain-language, specific, actionable
    priority: int  # higher = more urgent (low_stock=3, busy/approaching=2, slow=1)


# Minimum % deviation from the weekday mean to trigger a forecast nudge.
# 20% is a genuine signal for a small business; lower thresholds would spam.
_FORECAST_THRESHOLD = 0.20


def compute_forecast_nudge(
    tomorrow_predicted: int,
    tomorrow_weekday: str,
    weekday_mean: float,
) -> Nudge | None:
    """Return a nudge when tomorrow's forecast meaningfully deviates from the norm.

    A deviation of <20% is normal fluctuation and is never nudged.
    We compare the forecast to the historical weekday mean, not the
    prediction interval, because the mean captures what the owner
    'usually' sees — the interval is statistical and not actionable.
    """
    if weekday_mean <= 0:
        return None
    deviation = (tomorrow_predicted - weekday_mean) / weekday_mean
    usual = round(weekday_mean)

    if deviation >= _FORECAST_THRESHOLD:
        msg = (
            f"{tomorrow_weekday} looks unusually busy "
            f"(~{tomorrow_predicted} vs your usual ~{usual}) "
            f"— you may want extra help."
        )
        return Nudge(type="busy_tomorrow", message=msg, priority=2)

    if deviation <= -_FORECAST_THRESHOLD:
        msg = (
            f"{tomorrow_weekday} looks unusually slow "
            f"(~{tomorrow_predicted} vs your usual ~{usual}) "
            f"— you might be able to reduce staffing."
        )
        return Nudge(type="slow_tomorrow", message=msg, priority=1)

    return None


def compute_stock_nudge(ordering_products: list[dict]) -> Nudge | None:
    """Return a low-stock nudge from the list of ordering-row dicts.

    Each dict is expected to have: name, order_now, approaching_reorder,
    lead_time_days (all optional, fall back to False/0 if absent).
    Only fires when there is stock being tracked — untracked products
    are ignored (no fabricated alerts).
    """
    order_now = [
        p for p in ordering_products
        if p.get("order_now") and not p.get("stock_untracked")
    ]
    approaching = [
        p for p in ordering_products
        if p.get("approaching_reorder") and not p.get("order_now")
        and not p.get("stock_untracked")
    ]

    if order_now:
        names = _join_names([p["name"] for p in order_now])
        msg = (
            f"Stock is low for {names} — you're at or below the reorder point. "
            f"Place your order now to avoid running out."
        )
        return Nudge(type="low_stock", message=msg, priority=3)

    if approaching:
        names = _join_names([p["name"] for p in approaching])
        msg = (
            f"{names} is running low and will reach the reorder point soon. "
            f"Think about ordering in the next day or two."
        )
        return Nudge(type="approaching_stock", message=msg, priority=2)

    return None


def pick_top_nudge(nudges: list[Nudge]) -> Nudge | None:
    """Return the single highest-priority nudge, or None if no candidates."""
    if not nudges:
        return None
    return max(nudges, key=lambda n: n.priority)


def _join_names(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{names[0]}, {names[1]}, and {len(names) - 2} more"

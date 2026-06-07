"""
Live-sales engine: hourly roll-up of SaleEvent streams.

Pure functions — no DB, no framework imports.
Each SaleEvent is represented as a plain tuple (hour, product_id_or_None, quantity)
so the function is trivially testable without ORM objects.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date


def rollup_by_hour(
    events: list[tuple[int, int | None, float]],
) -> list[tuple[int, int, dict[int | None, float]]]:
    """Roll up tap events into per-hour summaries.

    Args:
        events: list of (hour 0–23, product_id or None, quantity) tuples.

    Returns:
        List of (hour, tap_count, {product_id_or_None: total_quantity}),
        sorted ascending by hour, only including hours that have at least one event.
    """
    by_hour: dict[int, list[tuple[int | None, float]]] = defaultdict(list)
    for hour, pid, qty in events:
        by_hour[hour].append((pid, qty))

    result: list[tuple[int, int, dict[int | None, float]]] = []
    for hour in sorted(by_hour.keys()):
        slots = by_hour[hour]
        totals: dict[int | None, float] = defaultdict(float)
        for pid, qty in slots:
            totals[pid] += qty
        result.append((hour, len(slots), dict(totals)))
    return result


def hourly_product_mix(
    events: list[tuple[date, int, int | None, float]],
    open_hours: set[int] | None = None,
) -> dict[int, dict[int | None, float]]:
    """Return {hour: {product_id_or_None: total_quantity}} across all days.

    Quantities are totals (not per-day averages) — the ratio between products
    is all that matters for weighted service-time math, so the n_days divisor
    cancels out and is not applied here.
    """
    totals: dict[int, dict[int | None, float]] = defaultdict(lambda: defaultdict(float))
    for _day, hour, pid, qty in events:
        if open_hours is None or hour in open_hours:
            totals[hour][pid] += qty
    return {h: dict(mix) for h, mix in totals.items()}


def reconcile_customers_with_hours(
    manual_total: int | None,
    hours_sum: float,
) -> tuple[int, str]:
    """Three-case hours-vs-total reconciliation (spec §9).

    Assumes hours_sum has already been filtered to open hours only.

    Cases:
    1. hours_sum > manual_total  → hours sum wins (more granular data)
    2. manual_total is None/0, hours_sum > 0 → hours sum used (derive total)
    3. hours_sum <= manual_total → keep manual total (gap = unknown hours)

    Returns (effective_customers, note).
    """
    has_hours = hours_sum > 0

    if not has_hours:
        return (manual_total or 0, "manual")

    if manual_total is None or manual_total == 0:
        return (round(hours_sum), "hours")

    if hours_sum > manual_total:
        return (round(hours_sum), "hours-greater")

    return (manual_total, "manual-with-unknown")


def hourly_averages(
    events: list[tuple[date, int, int | None, float]],
    open_hours: set[int] | None = None,
) -> list[tuple[int, float, int]]:
    """Average tap count per hour of day across all days in the dataset.

    Args:
        events:     list of (date, hour 0–23, product_id or None, quantity).
        open_hours: hours to include (e.g. {9,10,...,21}).  None = all hours.

    Returns:
        Sorted list of (hour, avg_taps_per_day, n_days_in_dataset).
        Only hours that have at least one tap in any day are returned.
        The average denominates over the full dataset size (days with zero
        taps at that hour count as zero, not as absent).
    """
    # Count only days that had at least one event within open hours.
    # Days whose taps are all outside the opening-hours window are not "tracked"
    # during open hours and must not dilute the per-hour averages.
    filtered_dates: set[date] = {
        day for day, hour, _pid, _qty in events
        if open_hours is None or hour in open_hours
    }
    n_days = len(filtered_dates)
    if n_days == 0:
        return []

    hour_totals: dict[int, float] = defaultdict(float)
    for day, hour, _pid, qty in events:
        if open_hours is None or hour in open_hours:
            hour_totals[hour] += qty

    return [
        (hour, round(hour_totals[hour] / n_days, 2), n_days)
        for hour in sorted(hour_totals.keys())
    ]

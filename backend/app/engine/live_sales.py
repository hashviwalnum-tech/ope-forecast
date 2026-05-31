"""
Live-sales engine: hourly roll-up of SaleEvent streams.

Pure functions — no DB, no framework imports.
Each SaleEvent is represented as a plain tuple (hour, product_id_or_None, quantity)
so the function is trivially testable without ORM objects.
"""
from __future__ import annotations

from collections import defaultdict


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

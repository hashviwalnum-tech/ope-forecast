"""
Per-product demand forecasting helpers — pure functions, no DB.

The forecasting engine already handles any numeric time-series; this module
adds the one product-specific step: trimming the demand series so that days
*before the first recorded sale* are excluded rather than treated as zero
(the product wasn't being tracked yet, so those zeroes are noise, not signal).
"""
from __future__ import annotations

from datetime import date


def round_qty(v: float, unit_mode: str) -> float:
    """Round a quantity per the product's unit_mode.

    'whole'   → nearest integer (never fractional — "order 45", never "45.3").
    'decimal' → two decimal places (e.g. "2.50 kg").

    This is the single source of truth for unit-mode rounding; every forecast
    and order quantity must pass through here so that whole-unit products can
    never produce a fractional output.
    """
    if unit_mode == "whole":
        return float(round(v))
    return round(v, 2)


def build_product_demand_series(
    day_ids_and_dates: list[tuple[int, date]],
    sales_by_day_id: dict[int, float],
) -> tuple[list[float], list[date]]:
    """Build a per-product daily demand series from the clean-record backbone.

    Starts from the first day this product has a recorded sale, so pre-tracking
    zeros are excluded.  Days *after* the first sale with no SaleRecord are kept
    as 0.0 (product was tracked but not sold that day).

    Args:
        day_ids_and_dates: (day_record_id, date) pairs in chronological order
                           — the caller's clean-record backbone.
        sales_by_day_id:   {day_record_id: units_sold} for this product.

    Returns:
        (demand, dates) — parallel lists starting from the first sale date.
        Both are empty when no sales data exists.
    """
    if not sales_by_day_id:
        return [], []

    first_idx = next(
        (i for i, (rid, _) in enumerate(day_ids_and_dates) if rid in sales_by_day_id),
        None,
    )
    if first_idx is None:
        return [], []

    relevant = day_ids_and_dates[first_idx:]
    demands = [float(sales_by_day_id.get(rid, 0.0)) for rid, _ in relevant]
    dates = [d for _, d in relevant]
    return demands, dates

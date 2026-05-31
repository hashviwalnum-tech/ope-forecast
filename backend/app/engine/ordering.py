"""
Ordering decisions: reorder point, safety stock, EOQ.
Pure functions — no DB, no framework imports.
"""
from __future__ import annotations

import math

from scipy.stats import norm


def demand_over_lead_time(avg_daily_demand: float, lead_time_days: int) -> float:
    """Expected total demand during the replenishment lead time."""
    if avg_daily_demand < 0:
        raise ValueError("avg_daily_demand must be non-negative")
    if lead_time_days < 1:
        raise ValueError("lead_time_days must be >= 1")
    return avg_daily_demand * lead_time_days


def safety_stock(z: float, sigma_over_lead_time: float) -> float:
    """Buffer stock = z × σ_dLT.

    z: service-level z-score (use service_level_z() to convert a percentage).
    sigma_over_lead_time: std dev of demand over the full lead-time window.
    """
    if sigma_over_lead_time < 0:
        raise ValueError("sigma_over_lead_time must be non-negative")
    return z * sigma_over_lead_time


def reorder_point(
    avg_daily_demand: float,
    lead_time_days: int,
    z: float,
    sigma_over_lead_time: float,
) -> float:
    """Stock level at which to place a replenishment order.

    = demand_over_lead_time + safety_stock
    """
    return (
        demand_over_lead_time(avg_daily_demand, lead_time_days)
        + safety_stock(z, sigma_over_lead_time)
    )


def economic_order_quantity(
    annual_demand: float,
    order_cost: float,
    holding_cost_per_unit: float,
) -> float:
    """Optimal order size: √(2DS/H).

    Minimises the sum of per-order setup cost and annual holding cost.
    Only meaningful when the product has both costs available (optional in Phase 1).
    """
    if annual_demand <= 0:
        raise ValueError("annual_demand must be positive")
    if order_cost <= 0:
        raise ValueError("order_cost must be positive")
    if holding_cost_per_unit <= 0:
        raise ValueError("holding_cost_per_unit must be positive")
    return math.sqrt(2 * annual_demand * order_cost / holding_cost_per_unit)


def service_level_z(service_level: float) -> float:
    """Normal-distribution z-score for a given service level (e.g. 0.95 → 1.645).

    Use the returned value as the *z* argument to safety_stock() and reorder_point().
    """
    if not (0 < service_level < 1):
        raise ValueError("service_level must be strictly between 0 and 1")
    return float(norm.ppf(service_level))

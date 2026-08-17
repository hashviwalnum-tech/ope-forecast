"""
Ordering decisions: reorder point, safety stock, EOQ, and batch-FIFO tracking.
Pure functions — no DB, no framework imports.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

from scipy.stats import norm


# ── Batch FIFO tracking ───────────────────────────────────────────────────────

@dataclass
class BatchInfo:
    """Snapshot of one stock batch sufficient for FIFO and spoilage math."""
    id: int
    quantity_remaining: float
    arrival_date: date
    expiry_date: date | None  # None when the product has no shelf-life set


def fifo_deplete(batches: list[BatchInfo], amount: float) -> tuple[list[BatchInfo], float]:
    """Deplete *amount* units from *batches* oldest-first (FIFO).

    Returns (updated_batches, actually_depleted) where actually_depleted may be
    less than amount if total remaining stock is insufficient.
    Batches are consumed oldest-first (sorted by arrival_date ascending).
    """
    if amount < 0:
        raise ValueError("amount must be non-negative")
    sorted_batches = sorted(batches, key=lambda b: b.arrival_date)
    remaining = amount
    updated: list[BatchInfo] = []
    for b in sorted_batches:
        if remaining <= 0:
            updated.append(b)
            continue
        take = min(b.quantity_remaining, remaining)
        remaining -= take
        updated.append(
            BatchInfo(
                id=b.id,
                quantity_remaining=b.quantity_remaining - take,
                arrival_date=b.arrival_date,
                expiry_date=b.expiry_date,
            )
        )
    actually_depleted = amount - max(remaining, 0.0)
    return updated, actually_depleted


def spoiled_or_at_risk(batches: list[BatchInfo], today: date) -> list[BatchInfo]:
    """Return batches that have expired (expiry_date <= today) with units still left.

    These are spoiled — the owner should be alerted.  Batches with no expiry_date
    (product has no shelf life set) are never considered spoiled.
    """
    return [
        b for b in batches
        if b.expiry_date is not None and b.expiry_date <= today and b.quantity_remaining > 0
    ]


def batches_expiring_before(batches: list[BatchInfo], cutoff: date) -> list[BatchInfo]:
    """Return batches that will expire strictly before *cutoff* with units remaining.

    Used to warn the owner about older stock that needs to sell before new stock arrives.
    """
    return [
        b for b in batches
        if b.expiry_date is not None and b.expiry_date < cutoff and b.quantity_remaining > 0
    ]


def total_remaining(batches: list[BatchInfo]) -> float:
    """Sum of quantity_remaining across all batches."""
    return sum(b.quantity_remaining for b in batches)


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


# How much cover, beyond the reorder point, a full shelf should aim to hold.
# One extra lead-time's worth means a delivery lands with roughly a lead time of
# stock still in hand rather than at the trigger line.
TARGET_COVER_LEAD_TIMES = 1.0


def order_up_to_target(
    avg_daily_demand: float,
    lead_time_days: int,
    reorder_point: float,
    current_stock: float,
    *,
    storage_capacity: float | None = None,
    target_cover_lead_times: float = TARGET_COVER_LEAD_TIMES,
) -> tuple[float, float]:
    """(target_level, order_quantity) for an order-up-to policy.

    The old rule ordered "demand over the lead time plus safety stock" — which is
    the reorder *trigger* itself. Ordering exactly the trigger amount when you
    have hit the trigger replenishes you back to roughly the trigger, so stock
    hovers at or just below the line forever and never builds a working buffer.
    Anything that knocks it further down — a busy week, a late delivery — is
    never recovered, because every order is sized to the trigger rather than to
    the shortfall.

    An order-up-to policy fixes that by asking a different question: not "how
    much do I usually use?" but **"how far below my target am I?"**  So a shop
    that has slipped to 100 below target orders that 100 back, and one that is
    already near target orders little.

    target = reorder point + one lead time's demand, capped at what physically
    fits.  Ordering is then simply ``target − current stock``, never negative.

    Returns the target as well as the quantity so callers can explain the advice.
    """
    if lead_time_days < 1:
        raise ValueError("lead_time_days must be >= 1")

    target = reorder_point + target_cover_lead_times * max(0.0, avg_daily_demand) * lead_time_days
    if storage_capacity is not None:
        target = min(target, storage_capacity)

    return target, max(0.0, target - current_stock)


def reorder_point_exceeds_capacity(
    reorder_point: float,
    storage_capacity: float | None,
) -> bool:
    """True when a product can never hold enough to cover its own lead time.

    If the shelf is smaller than the reorder point, stock is below the trigger
    the moment it is anything less than completely full, so the product shows as
    "order now" essentially forever no matter how diligently the owner orders.
    That is a configuration problem — too small a shelf, too long a lead time, or
    a demand estimate that has outgrown both — and the owner should be told,
    rather than left to wonder why the alert never clears.
    """
    return storage_capacity is not None and reorder_point > storage_capacity


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


def apply_order_constraints(
    base_order: float,
    *,
    storage_capacity: float | None = None,
    current_stock: float | None = None,
    shelf_life_days: int | None = None,
    avg_daily_demand: float | None = None,
) -> tuple[float, list[str], list[dict]]:
    """Cap a base order recommendation by storage and shelf-life constraints.

    Returns ``(capped_order, notes, codes)``:

    * ``notes`` — English prose, kept as the fallback for any client that does
      not understand a code yet;
    * ``codes`` — ``{"code": ..., "params": {...}}`` so the client can render the
      message in the owner's own language.  Backend-generated English shown raw
      in the UI is exactly the localisation leak the project spec keeps calling
      out, and the ordering advice is read daily.

    When neither constraint is set the order passes through unchanged and both
    lists are empty.

    Args:
        base_order: unconstrained recommended order quantity.
        storage_capacity: max units that physically fit (None = no cap).
        current_stock: units already on hand (defaults to 0 when None).
        shelf_life_days: days before the product spoils (None = no cap).
        avg_daily_demand: average daily units sold — required when shelf_life_days
                          is set; ignored otherwise.
    """
    order = base_order
    notes: list[str] = []
    codes: list[dict] = []

    if storage_capacity is not None:
        stock = current_stock if current_stock is not None else 0.0
        available_space = max(0.0, storage_capacity - stock)
        if order > available_space:
            order = available_space
            if available_space <= 0:
                # "Order now — quantity 0" is a contradiction the owner cannot
                # act on, and it happened 17 times over the simulated year.  Say
                # what is actually wrong instead: there is no room.
                notes.append(
                    "There's no room for more right now — your storage is full. "
                    "Sell some of what you have before reordering."
                )
                codes.append({"code": "storage_full", "params": {}})
            else:
                notes.append(
                    f"Capped at {available_space:.0f} — your storage limit."
                )
                codes.append({"code": "storage_capped",
                              "params": {"qty": round(available_space)}})

    if shelf_life_days is not None and avg_daily_demand is not None:
        sellable = avg_daily_demand * shelf_life_days
        if order > sellable:
            order = min(order, sellable)
            notes.append(
                f"Capped at {sellable:.0f} — more would spoil before selling "
                f"(shelf life: {shelf_life_days} days)."
            )
            codes.append({"code": "shelf_life_capped",
                          "params": {"qty": round(sellable), "days": shelf_life_days}})

    return order, notes, codes


def projected_stock_timeline(
    current_stock: float,
    daily_forecast: list[float],
    arrivals: list[tuple[int, float]],
) -> list[float]:
    """Day-by-day projected stock levels.

    Args:
        current_stock: units on hand right now.
        daily_forecast: expected units sold per future day (index 0 = today/day 0,
                        index 1 = tomorrow, …).
        arrivals: list of (day_offset, quantity) pairs representing pending orders.
                  An arrival on day_offset means stock is added BEFORE that day's sales.

    Returns a list the same length as daily_forecast.  Negative values mean
    projected stockout — the engine does not clamp at zero so callers can
    detect the first day stock runs out.
    """
    if current_stock < 0:
        raise ValueError("current_stock must be non-negative")
    stocks: list[float] = []
    stock = float(current_stock)
    for day, forecast in enumerate(daily_forecast):
        for offset, qty in arrivals:
            if offset == day:
                stock += qty
        stock -= forecast
        stocks.append(stock)
    return stocks


def will_stock_run_out(projected: list[float]) -> bool:
    """Return True when any projected stock level drops to or below zero."""
    return any(s <= 0 for s in projected)


def compute_current_projected_stock(
    baseline_stock: float,
    sales_since_baseline: float,
    arrivals_since_baseline: float,
) -> float:
    """Current projected stock from a known baseline.

    baseline_stock: units on hand at the baseline date (last manual count or starting stock).
    sales_since_baseline: total units sold since that date (draws stock down).
    arrivals_since_baseline: total units from orders that arrived since that date (adds to stock).

    Returns the projected current stock (may be negative if a stockout has occurred).
    """
    if baseline_stock < 0:
        raise ValueError("baseline_stock must be non-negative")
    if sales_since_baseline < 0:
        raise ValueError("sales_since_baseline must be non-negative")
    if arrivals_since_baseline < 0:
        raise ValueError("arrivals_since_baseline must be non-negative")
    return baseline_stock - sales_since_baseline + arrivals_since_baseline


def service_level_z(service_level: float) -> float:
    """Normal-distribution z-score for a given service level (e.g. 0.95 → 1.645).

    Use the returned value as the *z* argument to safety_stock() and reorder_point().
    """
    if not (0 < service_level < 1):
        raise ValueError("service_level must be strictly between 0 and 1")
    return float(norm.ppf(service_level))

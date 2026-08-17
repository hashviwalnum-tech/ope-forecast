"""
Live-sales engine: hourly roll-up of SaleEvent streams.

Pure functions — no DB, no framework imports.
Each SaleEvent is represented as a plain tuple (hour, product_id_or_None, quantity)
so the function is trivially testable without ORM objects.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

_UTC = timezone.utc

# Used when opening hours are not configured: cover most business windows
# without silently including overnight hours that shouldn't exist for any
# normal business (avoids 1–5am data leaking into peak-hours / staffing).
_DEFAULT_OPEN_HOURS: frozenset[int] = frozenset(range(6, 23))


def utc_to_local_dt(ts: datetime, tz_name: str) -> datetime:
    """Return ts converted to the business's local timezone.

    Naive datetimes are assumed UTC (matching SaleEvent storage).
    """
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=_UTC)
    return ts.astimezone(ZoneInfo(tz_name))


def utc_to_local_hour(ts: datetime, tz_name: str) -> int:
    """Return the local hour of a timestamp.

    Naive datetimes are assumed to be UTC (matching how SaleEvents are stored
    via ``app.clock.now_naive_utc()``).  The result is the hour in the
    business's local timezone so it can be compared against opening_hour /
    closing_hour, which are always expressed in local time.
    """
    return utc_to_local_dt(ts, tz_name).hour


def utc_to_local_date(ts: datetime, tz_name: str) -> date:
    """Return the local calendar date of a timestamp.

    Naive datetimes are assumed to be UTC.  A sale stored a few hours before
    UTC midnight can still fall on the *next* local calendar day (or vice
    versa) depending on the business's timezone — this is the single source
    of truth for "which local day does this sale belong to" used by daily
    rollups and reconciliation so they never bucket by the UTC day instead.
    """
    return utc_to_local_dt(ts, tz_name).date()


def local_day_utc_bounds(local_date: date, tz_name: str) -> tuple[datetime, datetime]:
    """Return the [start, end) naive-UTC bounds of one local calendar day.

    ``start`` is local midnight of ``local_date`` converted to naive UTC;
    ``end`` is local midnight of the following day, also in naive UTC — so a
    half-open ``timestamp >= start AND timestamp < end`` filter against the
    (naive-UTC) SaleEvent.timestamp column captures exactly that local day,
    including on DST-transition days where the local day is 23 or 25 hours.
    """
    tz = ZoneInfo(tz_name)
    start_local = datetime.combine(local_date, datetime.min.time(), tzinfo=tz)
    end_local = datetime.combine(local_date + timedelta(days=1), datetime.min.time(), tzinfo=tz)
    start_utc = start_local.astimezone(_UTC).replace(tzinfo=None)
    end_utc = end_local.astimezone(_UTC).replace(tzinfo=None)
    return start_utc, end_utc


def compute_open_hours(settings: dict) -> frozenset[int]:
    """Return the set of open hours for a business from its settings dict.

    Three cases:
    - Both opening_hour and closing_hour set, close > open: range(open, close).
    - Both set, overnight wrap-around (close < open, e.g. 22→06):
      range(open, 24) ∪ range(0, close).
    - Both equal (24/7): all 24 hours.
    - Not configured: _DEFAULT_OPEN_HOURS (6am–10pm).

    Out-of-hours data must never appear in peak-hours, hourly charts, or staffing.
    This function is the single source of truth for that filter.
    """
    raw_oh = settings.get("opening_hour")
    raw_ch = settings.get("closing_hour")
    if raw_oh is not None and raw_ch is not None:
        oh = int(raw_oh)
        ch = int(raw_ch)
        if ch > oh:
            return frozenset(range(oh, ch))
        if ch < oh:  # overnight wrap-around (e.g. 22:00–06:00)
            return frozenset(range(oh, 24)) | frozenset(range(0, ch))
        # oh == ch → treat as 24-hour open
        return frozenset(range(0, 24))
    return _DEFAULT_OPEN_HOURS


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


def customer_arrivals_by_day_hour(
    events: list[tuple[date, int, int | None, float]],
    open_hours: set[int] | None = None,
) -> dict[tuple[date, int], float]:
    """How many CUSTOMERS arrived in each (day, hour) — not how many units sold.

    This distinction is the whole point of the function.  A customer who buys a
    burger, fries and a drink is ONE arrival, not four.  Summing raw quantities
    inflates the arrival rate by the basket size, which then inflates every
    staffing recommendation and misstates the busiest-hour chart.

    Two tap styles are supported, decided per day so a business can change habit:
      * The owner taps "a customer arrived" (product_id is None) — including
        rows written by the hourly backfill, which store per-hour customer
        counts the same way.  Those quantities ARE the arrival count.
      * The owner only ever taps products.  Then each tap is one transaction,
        so arrivals = the number of tap events.

    Mirrors the rule ``rollup_tap_days`` already uses for the daily total, so
    the hourly view and the daily view can never disagree about the same day.
    """
    in_scope = [
        (day, hour, pid, qty) for day, hour, pid, qty in events
        if open_hours is None or hour in open_hours
    ]
    days_with_customer_taps = {day for day, _h, pid, _q in in_scope if pid is None}

    arrivals: dict[tuple[date, int], float] = defaultdict(float)
    for day, hour, pid, qty in in_scope:
        if day in days_with_customer_taps:
            if pid is None:
                arrivals[(day, hour)] += qty
        else:
            arrivals[(day, hour)] += 1.0     # one tap ≈ one transaction
    return dict(arrivals)


def hourly_averages(
    events: list[tuple[date, int, int | None, float]],
    open_hours: set[int] | None = None,
) -> list[tuple[int, float, int]]:
    """Average number of CUSTOMERS arriving per hour of day, across the dataset.

    Args:
        events:     list of (date, hour 0–23, product_id or None, quantity).
        open_hours: hours to include (e.g. {9,10,...,21}).  None = all hours.

    Returns:
        Sorted list of (hour, avg_customers_per_day, n_days_in_dataset).
        Only hours that have at least one arrival in any day are returned.
        The average denominates over the days actually tracked during open
        hours — a day where that hour saw nobody counts as a real zero, but a
        day the owner never tracked at all does not dilute the average.
    """
    arrivals = customer_arrivals_by_day_hour(events, open_hours)
    if not arrivals:
        return []

    n_days = len({day for day, _hour in arrivals})
    hour_totals: dict[int, float] = defaultdict(float)
    for (_day, hour), n in arrivals.items():
        hour_totals[hour] += n

    return [
        (hour, round(hour_totals[hour] / n_days, 2), n_days)
        for hour in sorted(hour_totals.keys())
    ]


def service_minutes_per_customer(
    events: list[tuple[date, int, int | None, float]],
    service_time_by_product: dict[int, float | None],
    default_service_time_minutes: float,
    open_hours: set[int] | None = None,
) -> dict[int, float]:
    """Minutes of staff work ONE customer costs, per hour of day.

    The queue model needs the time a single *customer* occupies a server.  That
    is the whole basket, not the average item: a customer who orders a burger
    (6 min), fries (2 min) and a drink (1 min) ties up staff for 9 minutes, not
    for the 3-minute average of those three items.

    So: total work in the hour ÷ customers in the hour.  Hours with no product
    detail — or none of the products carrying a service time — fall back to the
    business default, which is exactly what a business that only taps customer
    arrivals should get.

    The work total and the customer total MUST be measured over the same days.
    Most owners record product detail on only some days — they tap for a week,
    then switch to end-of-day totals — and dividing the work from those few days
    by the customers from all of them collapses the answer toward zero.  That
    produced "schedule 1 person" for a 69-customer hour: a 0.53-minute service
    time instead of 8 minutes, because a year of customer counts was divided
    into three weeks' worth of product detail.
    """
    detailed_days = {
        day for day, hour, pid, _qty in events
        if pid is not None and (open_hours is None or hour in open_hours)
    }
    if not detailed_days:
        # No product detail anywhere — the business's own average is the answer.
        arrivals = customer_arrivals_by_day_hour(events, open_hours)
        return {hour: default_service_time_minutes for (_d, hour) in arrivals}

    arrivals = customer_arrivals_by_day_hour(events, open_hours)
    customers_by_hour: dict[int, float] = defaultdict(float)
    detailed_customers: dict[int, float] = defaultdict(float)
    for (day, hour), n in arrivals.items():
        customers_by_hour[hour] += n
        if day in detailed_days:
            detailed_customers[hour] += n

    work_by_hour: dict[int, float] = defaultdict(float)
    for day, hour, pid, qty in events:
        if open_hours is not None and hour not in open_hours:
            continue
        if pid is None:
            continue                      # an arrival marker, not a sold item
        svc = service_time_by_product.get(pid)
        work_by_hour[hour] += qty * (svc if svc is not None else default_service_time_minutes)

    out: dict[int, float] = {}
    for hour in customers_by_hour:
        work = work_by_hour.get(hour, 0.0)
        base = detailed_customers.get(hour, 0.0)
        out[hour] = work / base if (work > 0 and base > 0) else default_service_time_minutes
    return out

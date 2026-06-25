"""
Analytics endpoints: /forecast, /accuracy, /lift, /weekday-averages, /ordering,
/forecast-history, /outliers.

Handler convention: validate → call engine → return.
Private helpers (_*) may orchestrate multiple engine calls but contain no formulas.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from statistics import mean, median, stdev

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.day_records import rollup_tap_days
from app.api.deps import get_business
from app.db import get_db
from app.engine.accuracy import detect_drift, forecast_errors, mad, mape, mse, tracking_signal
from app.engine.limits import history_cutoff
from app.engine.monthly import monthly_summary
from app.engine.ensemble import blend, model_weights, prediction_interval
from app.engine.forecasting import (
    exponential_smoothing,
    linear_trend,
    year_over_year_forecast,
    weighted_moving_average,
)
from app.engine.live_sales import compute_open_hours, hourly_averages, hourly_product_mix, utc_to_local_dt
from app.engine.ordering import (
    BatchInfo,
    apply_order_constraints,
    batches_expiring_before,
    compute_current_projected_stock,
    economic_order_quantity,
    fifo_deplete,
    projected_stock_timeline,
    reorder_point,
    safety_stock,
    service_level_z,
    spoiled_or_at_risk,
    total_remaining,
    will_stock_run_out,
)
from app.engine.outliers import detect_outliers
from app.engine.product_forecast import build_product_demand_series, round_qty
from app.engine.queueing import (
    effective_service_time,
    expected_wait_minutes,
    marginal_note,
    min_servers,
    min_servers_for_queue_threshold,
    min_servers_for_wait_threshold,
    queue_length,
)
from app.engine.seasonality import seasonal_naive_forecast
from app.models import Business, DayRecord, ForecastRun, Period, Product, RecurringPattern, SaleEvent, SaleRecord
from app.models.service_consumable import ServiceConsumable
from app.models.order_record import OrderRecord
from app.models.stock_batch import StockBatch
from app.schemas.analytics import (
    AccuracyResponse,
    ForecastDay,
    ForecastHistoryPoint,
    ForecastHistoryResponse,
    ForecastResponse,
    HistoryPoint,
    HourlyAnalyticsResponse,
    HourlySlotAvg,
    InsightsDayPattern,
    InsightsHourPattern,
    InsightsResponse,
    LiftResponse,
    MonthlyResponse,
    MonthSummary,
    OrderingResponse,
    OrderingRow,
    OutlierFlag,
    OutlierListResponse,
    PeriodLift,
    ProductForecastDay,
    ProductForecastItem,
    ProductForecastResponse,
    WeekdayAvg,
    WeekdayAvgResponse,
    WeekdayHourlyEntry,
    WeekdayHourlyResponse,
    WeekdayHourlySlot,
)

router = APIRouter(tags=["Analytics"])


# round_qty imported from engine.product_forecast — single source of truth
# for unit-mode rounding so the guard test in tests/engine/ covers all paths.
_round_qty = round_qty


# Preset WMA weights by window size (oldest→newest, sum=1, most-recent heaviest)
_WMA_WEIGHTS: dict[int, list[float]] = {
    1: [1.0],
    2: [0.35, 0.65],
    3: [0.20, 0.35, 0.45],
    4: [0.10, 0.20, 0.30, 0.40],
}

_WD_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_SERVICE_LEVEL = 0.95

MIN_RECORDS = 14  # ~2 weeks before forecasts are attempted


# ── stock projection helper ────────────────────────────────────────────────

def _compute_projected_stock(
    db: Session,
    biz_id: int,
    prod: Product,
    today: date,
    tap_by_prod_date: dict | None = None,
    assume_on_time: bool = False,
) -> tuple[float | None, bool]:
    """Compute projected current stock from the last known baseline.

    Returns (projected_stock, stock_untracked) where:
    - projected_stock is None when stock_untracked is True or no date anchor exists
    - stock_untracked is True when no current_stock has ever been set

    assume_on_time: when True, pending orders whose expected_arrival_date has
    passed are counted as received (the "always assume on time" setting).
    When False (default), only orders explicitly marked 'arrived' are counted.
    """
    if prod.current_stock is None:
        return None, True

    baseline_date = prod.stock_as_of_date
    if baseline_date is None:
        # Fall back to product creation date so existing products aren't penalised
        if prod.created_at:
            baseline_date = prod.created_at.date()
        else:
            # No anchor — return raw current_stock with no deductions
            return prod.current_stock, False

    # Sum all SaleRecords for this product since the baseline date
    rows = (
        db.query(SaleRecord.units_sold, DayRecord.date)
        .join(DayRecord, SaleRecord.day_record_id == DayRecord.id)
        .filter(
            DayRecord.business_id == biz_id,
            SaleRecord.product_id == prod.id,
            DayRecord.date > baseline_date,
        )
        .all()
    )
    sales_since = sum(float(r[0]) for r in rows)
    sale_record_dates: set[date] = {r[1] for r in rows}

    # Also count live taps (SaleEvents) on days that have no manual SaleRecord
    if tap_by_prod_date is not None:
        for (pid, d), qty in tap_by_prod_date.items():
            if pid == prod.id and d > baseline_date and d not in sale_record_dates:
                sales_since += qty

    # Add consumable depletion from services that use this product as a supply.
    # Each service performance (logged as a SaleRecord for the service) draws down
    # qty_per_performance units of this consumable.
    consumable_links = (
        db.query(ServiceConsumable)
        .filter_by(business_id=biz_id, consumable_product_id=prod.id)
        .all()
    )
    for link in consumable_links:
        svc_rows = (
            db.query(SaleRecord.units_sold)
            .join(DayRecord, SaleRecord.day_record_id == DayRecord.id)
            .filter(
                DayRecord.business_id == biz_id,
                SaleRecord.product_id == link.service_product_id,
                DayRecord.date > baseline_date,
            )
            .all()
        )
        sales_since += sum(float(r[0]) for r in svc_rows) * link.qty_per_performance

    # Sum arrivals from OrderRecords with expected_arrival_date in (baseline_date, today].
    # When assume_on_time is True: count pending orders whose expected date has passed.
    # When False: only count orders the owner explicitly confirmed as arrived.
    if assume_on_time:
        arrived_q = (
            db.query(OrderRecord)
            .filter(
                OrderRecord.business_id == biz_id,
                OrderRecord.product_id == prod.id,
                OrderRecord.status != "cancelled",
                OrderRecord.expected_arrival_date > baseline_date,
                OrderRecord.expected_arrival_date <= today,
            )
        )
    else:
        arrived_q = (
            db.query(OrderRecord)
            .filter(
                OrderRecord.business_id == biz_id,
                OrderRecord.product_id == prod.id,
                OrderRecord.status == "arrived",
                OrderRecord.expected_arrival_date > baseline_date,
                OrderRecord.expected_arrival_date <= today,
            )
        )
    arrivals_since = sum(float(o.quantity) for o in arrived_q.all())

    projected = compute_current_projected_stock(
        prod.current_stock, sales_since, arrivals_since
    )
    return projected, False


# ── batch FIFO advice helper ───────────────────────────────────────────────

def _batch_fifo_advice(
    db: Session,
    biz_id: int,
    prod: Product,
    today: date,
    lead_time_days: int,
) -> tuple[str | None, str | None, str | None]:
    """Compute FIFO-related advice strings for the ordering view.

    Returns (fifo_note, older_stock_warning, spoilage_alert).
    - fifo_note: shown whenever batches exist; reminds the owner FIFO is assumed.
    - older_stock_warning: when older batches will expire before new stock arrives.
    - spoilage_alert: when batches have already expired with units left.
    """
    from datetime import timedelta

    batches_db = (
        db.query(StockBatch)
        .filter_by(business_id=biz_id, product_id=prod.id)
        .filter(StockBatch.quantity_remaining > 0)
        .order_by(StockBatch.arrival_date)
        .all()
    )
    if not batches_db:
        return None, None, None

    batches = [
        BatchInfo(
            id=b.id,
            quantity_remaining=b.quantity_remaining,
            arrival_date=b.arrival_date,
            expiry_date=b.expiry_date,
        )
        for b in batches_db
    ]

    fifo_note = "Stock ordering assumes you sell oldest stock first (FIFO). Correct below if you sell newest-first."

    # Spoiled batches (expiry_date <= today, units still left)
    spoiled = spoiled_or_at_risk(batches, today)
    spoilage_alert: str | None = None
    if spoiled:
        names_and_qty = ", ".join(
            f"~{round(b.quantity_remaining)} {prod.unit} (expired {b.expiry_date})"
            for b in spoiled[:3]
        )
        spoilage_alert = f"Spoiled / at risk: {names_and_qty}. These should be removed from stock."

    # Older batches expiring before a new order could arrive (cutoff = today + lead_time)
    cutoff = today + timedelta(days=lead_time_days)
    expiring_soon = batches_expiring_before(batches, cutoff)
    # Exclude already-spoiled ones (already alerted above)
    expiring_soon = [b for b in expiring_soon if b not in spoiled]
    older_stock_warning: str | None = None
    if expiring_soon:
        total_qty = sum(b.quantity_remaining for b in expiring_soon)
        earliest_expiry = min(b.expiry_date for b in expiring_soon)  # type: ignore[arg-type]
        older_stock_warning = (
            f"You still have ~{round(total_qty)} {prod.unit} expiring around {earliest_expiry} "
            f"— sell those first before reordering. The new order becomes a separate, later-expiring batch."
        )

    return fifo_note, older_stock_warning, spoilage_alert


# ── private helpers ────────────────────────────────────────────────────────

def _open_days(biz: Business) -> set[int] | None:
    """Return the configured open weekdays (0=Mon … 6=Sun), or None if not set."""
    if not biz.settings:
        return None
    od = biz.settings.get("opening_days")
    return set(od) if od is not None else None


def _clean_records(db: Session, biz: Business) -> list[DayRecord]:
    """Return DayRecords, sorted by date, with these categories removed:
    - Dates inside a tagged event/ad Period (normal baseline exclusion).
    - Records the user resolved as 'excluded' (fluke) or 'event'.
    - Records whose weekday is a configured closed day (spec: closed days
      are excluded from forecasting entirely, not treated as zero).
    - Records older than the tier's history cap (free: 365 days).
    Records with outlier_status='flagged' (unreviewed) ARE included; their
    values are down-weighted by _effective_obs() rather than discarded.
    Un-logged open days are simply absent — never filled with zero.
    """
    # Auto-create DayRecords for any past tap-only days not yet rolled up.
    rollup_tap_days(db, biz)

    open_days = _open_days(biz)
    cutoff = history_cutoff(biz.tier, date.today())

    periods = db.query(Period).filter_by(business_id=biz.id).all()
    blocked: set[date] = set()
    for p in periods:
        d = p.start_date
        while d <= p.end_date:
            blocked.add(d)
            d += timedelta(days=1)

    query = db.query(DayRecord).filter_by(business_id=biz.id)
    if cutoff is not None:
        query = query.filter(DayRecord.date >= cutoff)

    return [
        r
        for r in query.order_by(DayRecord.date).all()
        if r.date not in blocked
        and r.outlier_status not in ("excluded", "event")
        and (open_days is None or r.date.weekday() in open_days)
    ]


def _effective_obs(records: list[DayRecord]) -> list[float]:
    """Convert records to a customer observation series.

    For unreviewed 'flagged' outliers the actual extreme value is replaced
    with the weekday median (computed from all other same-weekday values in
    the series). This down-weights the outlier without fully discarding it,
    so the forecast remains stable until the owner reviews the flag.
    'kept' records are used at face value; already-excluded records are not
    in the input list at all.
    """
    obs = [float(r.customers) for r in records]
    wds = [r.date.weekday() for r in records]

    flagged_indices = [i for i, r in enumerate(records) if r.outlier_status == "flagged"]
    if not flagged_indices:
        return obs

    result = obs.copy()
    for i in flagged_indices:
        wd = wds[i]
        # Use only non-flagged same-weekday values to avoid mutual contamination
        # when two spikes fall on the same weekday.
        same_wd = [
            obs[j] for j in range(len(obs))
            if wds[j] == wd and j != i and records[j].outlier_status != "flagged"
        ]
        if not same_wd:
            # Edge case: every same-weekday record is flagged; fall back to full set
            same_wd = [obs[j] for j in range(len(obs)) if wds[j] == wd and j != i]
        if same_wd:
            result[i] = median(same_wd)
    return result


def _exp_next(values: list[float], alpha: float = 0.3) -> float:
    """Apply single ES iteratively over a same-weekday series; return next forecast."""
    f = float(values[0])
    for actual in values[1:]:
        f = exponential_smoothing(alpha, f, actual)
    return f


def _wma_for_weekday(obs: list[float], wds: list[int], wd: int) -> float | None:
    """WMA over the last ≤4 same-weekday observations. Returns None if < 1 match."""
    same = [v for v, w in zip(obs, wds) if w == wd]
    n = min(len(same), 4)
    if n == 0:
        return None
    return weighted_moving_average(same, _WMA_WEIGHTS[n])


def _exp_for_weekday(obs: list[float], wds: list[int], wd: int) -> float | None:
    """ES next-step forecast for a weekday series. Returns None if < 2 matches."""
    same = [v for v, w in zip(obs, wds) if w == wd]
    if len(same) < 2:
        return None
    return _exp_next(same)


def _linear_trend_for_weekday(obs: list[float], wds: list[int], wd: int) -> float | None:
    """OLS linear trend over time-indexed same-weekday observations, predicting the next step.

    Uses sequential indices (0, 1, 2, …) so the slope measures change per additional
    same-weekday observation.  Returns None when fewer than 3 same-weekday points exist
    (OLS needs at least 2, but 3 gives a meaningful trend estimate).
    """
    same = [v for v, w in zip(obs, wds) if w == wd]
    if len(same) < 3:
        return None
    xs = list(range(len(same)))
    return linear_trend(xs, same, float(len(same)))


def _cap_linear_trend(pred: float, same_wd_obs: list[float]) -> float:
    """Clamp a linear-trend extrapolation to mean ± max(3σ, 50% of mean).

    A genuine steady rise/fall stays within this band; only extreme OLS
    extrapolations from a handful of data points are pulled back in.
    Customer counts are non-negative, so the lower bound is always 0.
    """
    if not same_wd_obs:
        return max(0.0, pred)
    mu = mean(same_wd_obs)
    sigma = stdev(same_wd_obs) if len(same_wd_obs) > 1 else 0.0
    half_band = max(3.0 * sigma, 0.5 * mu) if mu > 0 else 3.0 * sigma + 1.0
    return float(max(0.0, min(pred, mu + half_band)))


def _holdout_errors(
    obs: list[float],
    wds: list[int],
    dates: list[date] | None = None,
    n_per_weekday: int = 4,
) -> dict[str, dict[int, list[float]]]:
    """Leave-one-out signed errors (actual − predicted) for each model and weekday.

    For each weekday, the last n_per_weekday occurrences are treated as a holdout.
    Each point is predicted using only data that came before it in time.

    Models: seasonal_naive, wma, exp_smoothing, linear_trend, year_over_year.
    year_over_year requires dates to be provided; it produces no errors when
    no year-ago data exists.
    """
    result: dict[str, dict[int, list[float]]] = {
        "seasonal_naive": {},
        "wma": {},
        "exp_smoothing": {},
        "linear_trend": {},
        "year_over_year": {},
    }

    by_wd: dict[int, list[int]] = {}
    for i, wd in enumerate(wds):
        by_wd.setdefault(wd, []).append(i)

    for wd, all_idx in by_wd.items():
        sn: list[float] = []
        wma_e: list[float] = []
        exp_e: list[float] = []
        lt_e: list[float] = []
        yoy_e: list[float] = []

        for hi in all_idx[-n_per_weekday:]:
            t_obs = obs[:hi]
            t_wds = wds[:hi]
            actual = obs[hi]

            try:
                sn.append(actual - seasonal_naive_forecast(t_obs, t_wds, wd))
            except ValueError:
                pass

            p = _wma_for_weekday(t_obs, t_wds, wd)
            if p is not None:
                wma_e.append(actual - p)

            p = _exp_for_weekday(t_obs, t_wds, wd)
            if p is not None:
                exp_e.append(actual - p)

            p = _linear_trend_for_weekday(t_obs, t_wds, wd)
            if p is not None:
                lt_e.append(actual - p)

            if dates is not None:
                t_dates = dates[:hi]
                p = year_over_year_forecast(t_dates, t_obs, dates[hi])
                if p is not None:
                    yoy_e.append(actual - p)

        result["seasonal_naive"][wd] = sn
        result["wma"][wd] = wma_e
        result["exp_smoothing"][wd] = exp_e
        result["linear_trend"][wd] = lt_e
        result["year_over_year"][wd] = yoy_e

    return result


# ── /outliers ─────────────────────────────────────────────────────────────────

@router.get("/outliers", response_model=OutlierListResponse)
def get_outliers(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    """Detect and return unreviewed outlier days.

    Automatically rolls up any past tap-only days that don't yet have a
    DayRecord so that yesterday's taps always reach detection without requiring
    a manual trigger.  Detection uses only the clean baseline: event/ad period
    dates and closed weekdays are excluded from the reference set.
    """
    # Auto-roll up any past tap-only days before running detection so that a
    # day the owner tapped but never manually closed still gets evaluated.
    rollup_tap_days(db, biz)

    all_records = (
        db.query(DayRecord)
        .filter_by(business_id=biz.id)
        .order_by(DayRecord.date)
        .all()
    )

    if len(all_records) < MIN_RECORDS:
        return OutlierListResponse(status="ok", flags=[])

    # Build blocked-dates set from event/ad periods
    periods = db.query(Period).filter_by(business_id=biz.id).all()
    blocked: set[date] = set()
    for p in periods:
        d = p.start_date
        while d <= p.end_date:
            blocked.add(d)
            d += timedelta(days=1)

    open_days = _open_days(biz)

    # Recurring-pattern weekdays are never flagged as anomalies
    recurring_patterns = db.query(RecurringPattern).filter_by(business_id=biz.id).all()
    recurring_weekdays: set[int] = set()
    for rp in recurring_patterns:
        for wd in (rp.weekdays or []):
            recurring_weekdays.add(int(wd))

    # Candidate set: all open days that can be flagged — including days inside
    # event/ad periods.  The owner must still see the fluke prompt even during
    # a tagged period; an unusually weak event day may mean the event underperformed.
    det_records = [
        r for r in all_records
        if (open_days is None or r.date.weekday() in open_days)
        and r.outlier_status not in ("excluded", "event", "kept")
    ]

    # Reference set for IQR fence computation: full weekday history including
    # event-period days.  Excluding event periods from the reference decimates
    # same-weekday sample sizes and makes fences artificially tight (a normal
    # day crosses the fence because the reference only saw the busier non-event
    # days).  Days the owner explicitly resolved as "excluded" or "event" are
    # still omitted — they're deliberate editorial signals, not population data.
    ref_records = [
        r for r in all_records
        if (open_days is None or r.date.weekday() in open_days)
        and r.outlier_status not in ("excluded", "event")
    ]
    candidate_ids: set[int] = {r.id for r in det_records}

    if len(ref_records) >= MIN_RECORDS:
        ref_obs = [float(r.customers) for r in ref_records]
        ref_wds = [r.date.weekday() for r in ref_records]
        det_results = detect_outliers(ref_obs, ref_wds)
        detected_by_id = {
            ref_records[d.day_index].id: d
            for d in det_results
            if ref_records[d.day_index].id in candidate_ids
        }
    else:
        detected_by_id = {}

    changed = False

    # Auto-resolve records on recurring-pattern weekdays
    for r in all_records:
        if r.outlier_status == "flagged" and r.date.weekday() in recurring_weekdays:
            r.outlier_status = "kept"
            changed = True

    # Auto-resolve stale flags: candidate days previously flagged that the wider
    # reference set no longer considers extreme.  Only runs when detection executed;
    # if the reference was too small, existing flags are left untouched.
    if len(ref_records) >= MIN_RECORDS:
        for r in all_records:
            if r.outlier_status == "flagged" and r.id in candidate_ids and r.id not in detected_by_id:
                r.outlier_status = None
                changed = True

    # Flag newly detected records (only in detection set, only unreviewed, skip recurring)
    for r in det_records:
        if r.outlier_status is None and r.id in detected_by_id:
            if r.date.weekday() not in recurring_weekdays:
                r.outlier_status = "flagged"
                changed = True

    if changed:
        db.commit()

    # Build response for all currently-flagged records
    flags: list[OutlierFlag] = []
    for r in all_records:
        if r.outlier_status != "flagged":
            continue

        det = detected_by_id.get(r.id)
        wd_name = _WD_NAMES[r.date.weekday()]

        if det:
            median_val = det.weekday_median
            direction = det.direction
        else:
            # Still flagged but no longer in detection results; best-effort context
            same = [
                float(x.customers) for x in det_records
                if x.date.weekday() == r.date.weekday() and x.id != r.id
            ]
            median_val = round(float(median(same)), 1) if same else 0.0
            direction = "high" if r.customers > median_val else "low"

        if direction == "high":
            msg = (
                f"{wd_name} {r.date} looks unusually high "
                f"({r.customers:,} vs your usual ~{median_val:.0f}). "
                f"Was this a special event, or a one-off?"
            )
        else:
            msg = (
                f"{wd_name} {r.date} looks unusually low "
                f"({r.customers:,} vs your usual ~{median_val:.0f}). "
                f"Were you closed, or is this a fluke?"
            )

        flags.append(OutlierFlag(
            day_record_id=r.id,
            date=r.date,
            weekday=wd_name,
            customers=r.customers,
            weekday_median=median_val,
            direction=direction,
            message=msg,
        ))

    flags.sort(key=lambda f: f.date)
    return OutlierListResponse(status="ok", flags=flags)


# ── /forecast ─────────────────────────────────────────────────────────────

@router.get("/forecast", response_model=ForecastResponse)
def get_forecast(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    records = _clean_records(db, biz)

    if len(records) < MIN_RECORDS:
        return ForecastResponse(
            status="not_enough_data",
            message=f"Need at least {MIN_RECORDS} clean days of data "
                    f"({len(records)} so far). Keep logging.",
            days=[],
        )

    obs = _effective_obs(records)
    wds = [r.date.weekday() for r in records]
    dates = [r.date for r in records]

    holdout = _holdout_errors(obs, wds, dates, n_per_weekday=4)

    today = date.today()
    open_days = _open_days(biz)
    days: list[ForecastDay] = []

    for offset in range(1, 8):
        target_date = today + timedelta(days=offset)
        wd = target_date.weekday()
        if open_days is not None and wd not in open_days:
            continue  # don't forecast closed days

        preds: dict[str, float] = {}
        maes: dict[str, float] = {}

        try:
            _sn = seasonal_naive_forecast(obs, wds, wd)
            errs = holdout["seasonal_naive"].get(wd, [])
            if errs:
                preds["seasonal_naive"] = _sn
                maes["seasonal_naive"] = mad([abs(e) for e in errs])
        except ValueError:
            pass

        p = _wma_for_weekday(obs, wds, wd)
        if p is not None:
            errs = holdout["wma"].get(wd, [])
            if errs:
                preds["wma"] = p
                maes["wma"] = mad([abs(e) for e in errs])

        p = _exp_for_weekday(obs, wds, wd)
        if p is not None:
            errs = holdout["exp_smoothing"].get(wd, [])
            if errs:
                preds["exp_smoothing"] = p
                maes["exp_smoothing"] = mad([abs(e) for e in errs])

        p = _linear_trend_for_weekday(obs, wds, wd)
        if p is not None:
            errs = holdout["linear_trend"].get(wd, [])
            if errs:
                same_wd = [v for v, w in zip(obs, wds) if w == wd]
                preds["linear_trend"] = _cap_linear_trend(p, same_wd)
                maes["linear_trend"] = mad([abs(e) for e in errs])

        p = year_over_year_forecast(dates, obs, target_date)
        if p is not None:
            errs = holdout["year_over_year"].get(wd, [])
            if errs:
                preds["year_over_year"] = p
                maes["year_over_year"] = mad([abs(e) for e in errs])

        if not preds:
            continue

        weights = model_weights(list(maes.values()))
        forecast_val = blend(list(preds.values()), weights)

        # Only use errors from models that were actually included in the blend,
        # so unvalidated models' wild holdout errors don't inflate the spread.
        all_wd_errs: list[float] = []
        for model_name in preds:
            all_wd_errs.extend(holdout[model_name].get(wd, []))

        if len(all_wd_errs) >= 2:
            lo, hi = prediction_interval(forecast_val, all_wd_errs)
            lo = max(0.0, lo)  # customer counts can't be negative
        else:
            lo, hi = forecast_val, forecast_val

        weights_out = {m: round(w, 4) for m, w in zip(preds.keys(), weights)}

        pred_int = round(forecast_val)
        lo_int = max(0, round(lo))
        hi_int = max(0, round(hi))

        db.add(ForecastRun(
            business_id=biz.id,
            created_at=datetime.utcnow(),
            target_date=target_date,
            predicted_value=pred_int,
            interval_low=lo_int,
            interval_high=hi_int,
            model_weights=weights_out,
        ))

        days.append(ForecastDay(
            date=target_date,
            weekday=target_date.strftime("%A"),
            predicted_customers=pred_int,
            interval_low=lo_int,
            interval_high=hi_int,
            model_weights=weights_out,
        ))

    db.commit()
    drift = detect_drift(obs)
    return ForecastResponse(status="ok", days=days, drift_alert=drift)


# ── /accuracy ─────────────────────────────────────────────────────────────

@router.get("/accuracy", response_model=AccuracyResponse)
def get_accuracy(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    records = _clean_records(db, biz)

    if len(records) < MIN_RECORDS:
        return AccuracyResponse(
            status="not_enough_data",
            n_observations=len(records),
            message=f"Need at least {MIN_RECORDS} clean days. "
                    f"({len(records)} so far). Keep logging.",
        )

    obs = _effective_obs(records)
    wds = [r.date.weekday() for r in records]

    n_eval = min(90, len(obs) - 7)
    actuals: list[float] = []
    predictions: list[float] = []

    for i in range(len(obs) - n_eval, len(obs)):
        try:
            pred = seasonal_naive_forecast(obs[:i], wds[:i], wds[i])
            actuals.append(obs[i])
            predictions.append(pred)
        except ValueError:
            pass

    if len(actuals) < 4:
        return AccuracyResponse(
            status="not_enough_data",
            n_observations=len(actuals),
            message="Not enough same-weekday data to evaluate accuracy yet.",
        )

    errors = forecast_errors(actuals, predictions)
    ts = tracking_signal(errors)
    bias_warning = (
        "Forecast is biased — model may need recalibration (|tracking signal| > 4)"
        if abs(ts) > 4
        else None
    )

    try:
        mape_val = round(mape(actuals, predictions), 2)
    except ValueError:
        mape_val = None

    drift = detect_drift(obs)

    return AccuracyResponse(
        status="ok",
        n_observations=len(actuals),
        mad=round(mad(errors), 2),
        mse=round(mse(errors), 2),
        mape=mape_val,
        tracking_signal=round(ts, 3),
        bias_warning=bias_warning,
        drift_alert=drift,
    )


# ── /lift ─────────────────────────────────────────────────────────────────

@router.get("/lift", response_model=LiftResponse)
def get_lift(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    periods = (
        db.query(Period)
        .filter_by(business_id=biz.id)
        .order_by(Period.start_date)
        .all()
    )

    if not periods:
        return LiftResponse(
            status="no_periods",
            message="No event or ad periods defined yet. "
                    "Create a period via POST /periods to measure lift.",
            periods=[],
        )

    all_records = (
        db.query(DayRecord)
        .filter_by(business_id=biz.id)
        .order_by(DayRecord.date)
        .all()
    )

    result: list[PeriodLift] = []

    for period in periods:
        period_records = [
            r for r in all_records
            if period.start_date <= r.date <= period.end_date
        ]
        if not period_records:
            continue

        open_days = _open_days(biz)
        train_records = [
            r for r in all_records
            if not (period.start_date <= r.date <= period.end_date)
            and r.outlier_status not in ("excluded", "event")
            and (open_days is None or r.date.weekday() in open_days)
        ]

        # Determine what to measure: product-level sales or total customers.
        # target_product_id=None → measure total customers (default).
        # target_product_id set → measure that product's daily units sold.
        target_pid = getattr(period, "target_product_id", None)

        if target_pid is not None:
            # Build product-level demand series for the target product
            prod_sale_map: dict[int, float] = {}
            for sr in db.query(SaleRecord).join(
                DayRecord, SaleRecord.day_record_id == DayRecord.id
            ).filter(
                DayRecord.business_id == biz.id,
                SaleRecord.product_id == target_pid,
            ).all():
                prod_sale_map[sr.day_record_id] = float(sr.units_sold)

            # Actual = sum of product units during the period
            total_actual = sum(prod_sale_map.get(r.id, 0.0) for r in period_records)

            # Baseline: use product demand series for training
            train_prod_obs = [prod_sale_map.get(r.id, 0.0) for r in train_records if r.id in prod_sale_map]
            train_prod_wds = [r.date.weekday() for r in train_records if r.id in prod_sale_map]
            total_baseline = 0.0
            for r in period_records:
                try:
                    total_baseline += seasonal_naive_forecast(train_prod_obs, train_prod_wds, r.date.weekday())
                except ValueError:
                    total_baseline += float(mean(train_prod_obs)) if train_prod_obs else 0.0
        else:
            # Default: measure total customers
            train_obs = _effective_obs(train_records)
            train_wds = [r.date.weekday() for r in train_records]
            total_actual = sum(float(r.customers) for r in period_records)
            total_baseline = 0.0
            for r in period_records:
                try:
                    total_baseline += seasonal_naive_forecast(train_obs, train_wds, r.date.weekday())
                except ValueError:
                    total_baseline += float(mean(train_obs)) if train_obs else 0.0

        total_lift = total_actual - total_baseline
        pct_lift = (total_lift / total_baseline * 100) if total_baseline else 0.0
        lift_per_cost = (total_lift / period.cost) if period.cost else None

        result.append(PeriodLift(
            period_id=period.id,
            label=period.label,
            type=period.type,
            start_date=period.start_date,
            end_date=period.end_date,
            target_product_id=target_pid,
            total_actual=round(total_actual, 1),
            total_baseline=round(total_baseline, 1),
            total_lift_customers=round(total_lift, 1),
            pct_lift=round(pct_lift, 1),
            lift_per_cost=round(lift_per_cost, 2) if lift_per_cost is not None else None,
        ))

    return LiftResponse(status="ok", periods=result)


# ── /weekday-averages ──────────────────────────────────────────────────────────

@router.get("/weekday-averages", response_model=WeekdayAvgResponse)
def get_weekday_averages(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    records = _clean_records(db, biz)
    if len(records) < 7:
        return WeekdayAvgResponse(
            status="not_enough_data",
            message=f"Need at least 7 days of data ({len(records)} so far). Keep logging.",
            weekdays=[],
        )

    obs = _effective_obs(records)

    by_wd: dict[int, list[float]] = {i: [] for i in range(7)}
    for r, v in zip(records, obs):
        by_wd[r.date.weekday()].append(v)

    weekdays = []
    for i, name in enumerate(_WD_NAMES):
        vals = by_wd[i]
        avg = mean(vals) if vals else 0.0
        std = stdev(vals) if len(vals) > 1 else 0.0
        weekdays.append(WeekdayAvg(
            weekday=name,
            weekday_idx=i,
            avg_customers=round(avg, 1),
            std_dev=round(std, 1),
            n_observations=len(vals),
        ))

    return WeekdayAvgResponse(status="ok", weekdays=weekdays)


# ── /ordering ─────────────────────────────────────────────────────────────────

@router.get("/ordering", response_model=OrderingResponse)
def get_ordering(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    products_list = db.query(Product).filter_by(business_id=biz.id).all()
    if not products_list:
        return OrderingResponse(
            status="no_products",
            message="No products defined yet. Add products via POST /products.",
            products=[],
        )

    # Use the same clean-record backbone as the forecast engine:
    # period-excluded, tier-capped, outlier-resolved, closed-days removed.
    all_records = _clean_records(db, biz)
    if len(all_records) < MIN_RECORDS:
        return OrderingResponse(
            status="not_enough_data",
            message=f"Need at least {MIN_RECORDS} days of data for ordering recommendations "
                    f"({len(all_records)} so far).",
            products=[],
        )

    ids_and_dates = [(r.id, r.date) for r in all_records]
    z = service_level_z(_SERVICE_LEVEL)
    today = date.today()
    assume_on_time = bool((biz.settings or {}).get("assume_orders_arrive_on_time", False))
    result: list[OrderingRow] = []

    for prod in products_list:
        # Services are performed, not held — skip them entirely in the reorder view.
        if getattr(prod, "product_type", "stocked") == "service":
            continue

        sales = (
            db.query(SaleRecord)
            .join(DayRecord, SaleRecord.day_record_id == DayRecord.id)
            .filter(DayRecord.business_id == biz.id)
            .filter(SaleRecord.product_id == prod.id)
            .all()
        )
        sr_by_day: dict[int, float] = {s.day_record_id: float(s.units_sold) for s in sales}

        # Trim pre-tracking zeros: only count days from the first recorded sale onward.
        # Days before a product was tracked are absent from history, not zero demand.
        daily_demand, _ = build_product_demand_series(ids_and_dates, sr_by_day)

        n_data = len(daily_demand)
        if n_data == 0:
            proj_s, s_untracked = _compute_projected_stock(db, biz.id, prod, today, assume_on_time=assume_on_time)
            fifo_n, older_w, spoil_a = _batch_fifo_advice(db, biz.id, prod, today, prod.lead_time_days)
            result.append(OrderingRow(
                product_id=prod.id,
                name=prod.name,
                unit=prod.unit,
                avg_daily_demand=0.0,
                lead_time_days=prod.lead_time_days,
                safety_stock_units=0.0,
                reorder_point=0.0,
                current_stock=prod.current_stock,
                projected_stock=proj_s,
                stock_untracked=s_untracked,
                approaching_reorder=False,
                order_now=False,
                eoq=None,
                suggested_order_qty=0.0,
                fifo_note=fifo_n,
                older_stock_warning=older_w,
                spoilage_alert=spoil_a,
            ))
            continue

        avg_daily = mean(daily_demand)
        sigma_daily = stdev(daily_demand) if n_data > 1 else 0.0
        sigma_lt = sigma_daily * math.sqrt(prod.lead_time_days)

        ss = safety_stock(z, sigma_lt)
        rop = reorder_point(avg_daily, prod.lead_time_days, z, sigma_lt)

        eoq_val = None
        base_qty = avg_daily * prod.lead_time_days + ss
        unit_mode = getattr(prod, "unit_mode", "whole") or "whole"

        proj_stock, stock_untracked = _compute_projected_stock(db, biz.id, prod, today, assume_on_time=assume_on_time)
        effective_stock = proj_stock if proj_stock is not None else prod.current_stock

        constrained_qty, cap_notes = apply_order_constraints(
            base_qty,
            storage_capacity=prod.storage_capacity,
            current_stock=effective_stock,
            shelf_life_days=prod.shelf_life_days,
            avg_daily_demand=avg_daily,
        )
        suggested_qty = _round_qty(constrained_qty, unit_mode)
        order_now = effective_stock is not None and not stock_untracked and effective_stock <= rop
        approaching_reorder = (
            not stock_untracked and
            effective_stock is not None and
            effective_stock > rop and
            effective_stock <= rop + avg_daily * prod.lead_time_days
        )

        fifo_n, older_w, spoil_a = _batch_fifo_advice(db, biz.id, prod, today, prod.lead_time_days)

        result.append(OrderingRow(
            product_id=prod.id,
            name=prod.name,
            unit=prod.unit,
            unit_mode=unit_mode,
            avg_daily_demand=_round_qty(avg_daily, unit_mode),
            lead_time_days=prod.lead_time_days,
            safety_stock_units=_round_qty(ss, unit_mode),
            reorder_point=_round_qty(rop, unit_mode),
            current_stock=prod.current_stock,
            projected_stock=_round_qty(proj_stock, unit_mode) if proj_stock is not None else None,
            stock_untracked=stock_untracked,
            approaching_reorder=approaching_reorder,
            order_now=order_now,
            eoq=eoq_val,
            suggested_order_qty=suggested_qty,
            constraint_notes=cap_notes,
            fifo_note=fifo_n,
            older_stock_warning=older_w,
            spoilage_alert=spoil_a,
        ))

    return OrderingResponse(status="ok", products=result)


# ── /forecast-history ─────────────────────────────────────────────────────────

@router.get("/forecast-history", response_model=ForecastHistoryResponse)
def get_forecast_history(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    today = date.today()

    past_runs = (
        db.query(ForecastRun)
        .filter_by(business_id=biz.id)
        .filter(ForecastRun.target_date < today)
        .order_by(ForecastRun.target_date, ForecastRun.created_at)
        .all()
    )

    actual_map = {
        r.date: r
        for r in db.query(DayRecord).filter_by(business_id=biz.id).all()
    }

    seen: set[date] = set()
    history: list[ForecastHistoryPoint] = []
    for fr in past_runs:
        if fr.target_date in seen:
            continue
        seen.add(fr.target_date)
        actual = actual_map.get(fr.target_date)
        if actual is None:
            continue
        history.append(ForecastHistoryPoint(
            date=fr.target_date,
            weekday=fr.target_date.strftime("%A"),
            predicted=round(fr.predicted_value),
            actual=float(actual.customers),
            interval_low=round(fr.interval_low) if fr.interval_low is not None else None,
            interval_high=round(fr.interval_high) if fr.interval_high is not None else None,
        ))

    if not history:
        return ForecastHistoryResponse(
            status="no_history",
            message="No forecast history yet. Past forecasts will appear here once their dates pass.",
            history=[],
        )

    return ForecastHistoryResponse(status="ok", history=history)


# ── /hourly-analytics ─────────────────────────────────────────────────────────

MIN_HOURLY_DAYS = 7  # one week of tap data before patterns are meaningful


def _recommended_staff(
    arrivals_per_hour: float,
    eff_svc: float,
    settings: dict,
) -> int:
    """Pick the smallest staff count satisfying the owner's threshold.

    Priority:
    1. staffing_max_wait_minutes  — if set, find min c so wait ≤ threshold.
    2. staffing_max_queue_length  — if set, find min c so queue ≤ threshold.
    3. Fallback to utilisation-cap (UTILISATION_CAP = 85%).
    """
    max_wait = settings.get("staffing_max_wait_minutes")
    max_queue = settings.get("staffing_max_queue_length")
    if max_wait is not None:
        try:
            return min_servers_for_wait_threshold(arrivals_per_hour, eff_svc, float(max_wait))
        except Exception:
            pass
    if max_queue is not None:
        try:
            return min_servers_for_queue_threshold(arrivals_per_hour, eff_svc, float(max_queue))
        except Exception:
            pass
    return min_servers(arrivals_per_hour, eff_svc)


def _fmt_hour_range(hour: int) -> str:
    """Format a 1-hour window: 9→'9–10 am', 12→'12–1 pm', 17→'5–6 pm'."""
    def _h(h: int) -> str:
        h24 = h % 24
        if h24 == 0:   return "12"
        if h24 <= 12:  return str(h24)
        return str(h24 - 12)

    def _suf(h: int) -> str:
        return "am" if h % 24 < 12 else "pm"

    end = hour + 1
    if _suf(hour) == _suf(end):
        return f"{_h(hour)}–{_h(end)} {_suf(hour)}"
    return f"{_h(hour)} {_suf(hour)}–{_h(end)} {_suf(end)}"


@router.get("/hourly-analytics", response_model=HourlyAnalyticsResponse)
def get_hourly_analytics(
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Busiest-hour view and staffing recommendations from tap-recorded SaleEvents.

    Respects opening_hour / closing_hour so off-hours are excluded.
    Requires MIN_HOURLY_DAYS distinct days of tap data.
    """
    settings = biz.settings or {}
    avg_svc = float(settings.get("avg_service_time_minutes", 5.0))
    open_hours = compute_open_hours(settings)
    tz_name: str = settings.get("timezone", "UTC")

    events = (
        db.query(SaleEvent)
        .filter_by(business_id=biz.id)
        .order_by(SaleEvent.timestamp)
        .all()
    )

    if not events:
        return HourlyAnalyticsResponse(
            status="not_enough_data",
            message=(
                'No tap data yet. Use "Record a Sale" to log each customer '
                'as they arrive — hourly patterns and staffing advice appear '
                f'after {MIN_HOURLY_DAYS} different days of taps.'
            ),
            n_days_data=0,
            avg_service_time_minutes=avg_svc,
        )

    raw = [
        (lt.date(), lt.hour, e.product_id, e.quantity)
        for e in events
        for lt in [utc_to_local_dt(e.timestamp, tz_name)]
    ]
    n_days = len({ev[0] for ev in raw})

    if n_days < MIN_HOURLY_DAYS:
        remaining = MIN_HOURLY_DAYS - n_days
        return HourlyAnalyticsResponse(
            status="not_enough_data",
            message=(
                f"Keep tapping! You have {n_days} day{'s' if n_days != 1 else ''} of tap data. "
                f"Log about {remaining} more day{'s' if remaining != 1 else ''} "
                f"for reliable hourly patterns."
            ),
            n_days_data=n_days,
            avg_service_time_minutes=avg_svc,
        )

    avgs = hourly_averages(raw, open_hours)
    mix_by_hour = hourly_product_mix(raw, open_hours)

    # Build a product_id → service_time_minutes lookup (None when not set)
    products_list = db.query(Product).filter_by(business_id=biz.id).all()
    svc_by_pid: dict[int, float | None] = {p.id: p.service_time_minutes for p in products_list}

    hours: list[HourlySlotAvg] = []
    for hour, avg_taps_raw, n in avgs:
        avg_taps_int = int(round(avg_taps_raw))  # customers are whole people
        hour_mix = mix_by_hour.get(hour, {})
        # (quantity, service_time_or_None) — None product_id or no override → falls back to default
        product_mix_pairs = [(qty, svc_by_pid.get(pid)) for pid, qty in hour_mix.items()]
        eff_svc = effective_service_time(product_mix_pairs, avg_svc) if product_mix_pairs else avg_svc
        staff = _recommended_staff(avg_taps_raw, eff_svc, settings)
        time_range = _fmt_hour_range(hour)
        word = "person" if staff == 1 else "people"
        hours.append(HourlySlotAvg(
            hour=hour,
            avg_taps=avg_taps_int,
            n_days=n,
            recommended_staff=staff,
            label=f"For {time_range}, schedule {staff} {word}",
            expected_wait_minutes=round(expected_wait_minutes(avg_taps_raw, eff_svc, staff), 1),
            queue_length=round(queue_length(avg_taps_raw, eff_svc, staff), 2),
            marginal_note=marginal_note(avg_taps_raw, eff_svc, staff),
        ))

    return HourlyAnalyticsResponse(
        status="ok",
        n_days_data=n_days,
        avg_service_time_minutes=avg_svc,
        hours=hours,
    )


# ── /monthly-summary ──────────────────────────────────────────────────────────

@router.get("/monthly-summary", response_model=MonthlyResponse)
def get_monthly_summary(
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Monthly aggregation of clean customer data for the trends view.

    Applies the same cleaning rules as the forecasting engine:
    - event/ad periods excluded
    - outlier 'excluded'/'event' records dropped
    - closed weekdays excluded
    - unreviewed 'flagged' outliers replaced with their weekday median
    - missing days are simply absent (never zero-filled)
    """
    records = _clean_records(db, biz)

    if not records:
        return MonthlyResponse(
            status="not_enough_data",
            message=(
                "No data logged yet. Start adding daily customer counts "
                "and monthly trends will appear here."
            ),
        )

    obs = _effective_obs(records)
    day_data = [(r.date, v) for r, v in zip(records, obs)]

    months_raw = monthly_summary(day_data)

    return MonthlyResponse(
        status="ok",
        n_total_days=len(records),
        months=[MonthSummary(**m) for m in months_raw],
        history_points=[
            HistoryPoint(date=d, customers=v) for d, v in day_data
        ],
    )


# ── /product-forecast ─────────────────────────────────────────────────────────

MIN_PRODUCT_RECORDS = 7  # one full week of tracked sales


@router.get("/product-forecast", response_model=ProductForecastResponse)
def get_product_forecast(
    product_id: int | None = Query(None, description="Filter to a single product"),
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Per-product 7-day demand forecast and ordering advice.

    Applies the same ensemble engine as /forecast to each product's daily
    unit-sales history (SaleRecord + SaleEvent data merged).  Ordering advice
    uses the forecast mean over the lead time rather than the historical mean,
    giving more responsive reorder-point estimates.

    Pass ?product_id=N to restrict the response to one product.
    """
    q = db.query(Product).filter_by(business_id=biz.id)
    if product_id is not None:
        q = q.filter(Product.id == product_id)
    products_list = q.order_by(Product.name).all()

    if not products_list:
        msg = (
            "Product not found." if product_id is not None
            else "No products defined yet. Add products via My Products."
        )
        return ProductForecastResponse(status="no_products", message=msg, products=[])

    # Clean-record backbone (period-excluded, tier-filtered, outlier-handled)
    clean_records = _clean_records(db, biz)

    # Aggregate tap (SaleEvent) data by (product_id, date) — fallback when no
    # manual SaleRecord exists for a day
    all_events = (
        db.query(SaleEvent)
        .filter_by(business_id=biz.id)
        .all()
    )
    tap_by_prod_date: dict[tuple[int, date], float] = {}
    for se in all_events:
        if se.product_id is None:
            continue
        key = (se.product_id, se.timestamp.date())
        tap_by_prod_date[key] = tap_by_prod_date.get(key, 0.0) + se.quantity

    today = date.today()
    open_days = _open_days(biz)
    z = service_level_z(_SERVICE_LEVEL)
    assume_on_time = bool((biz.settings or {}).get("assume_orders_arrive_on_time", False))
    ids_and_dates = [(r.id, r.date) for r in clean_records]

    result: list[ProductForecastItem] = []

    for prod in products_list:
        prod_type = getattr(prod, "product_type", "stocked") or "stocked"

        # ── build demand series ───────────────────────────────────────────────
        sale_records = (
            db.query(SaleRecord)
            .join(DayRecord, SaleRecord.day_record_id == DayRecord.id)
            .filter(DayRecord.business_id == biz.id, SaleRecord.product_id == prod.id)
            .all()
        )
        sr_by_day: dict[int, float] = {
            sr.day_record_id: float(sr.units_sold) for sr in sale_records
        }

        # For days in the backbone with no manual SaleRecord, fall back to tap data
        enriched: dict[int, float] = dict(sr_by_day)
        for r in clean_records:
            if r.id not in enriched:
                tap = tap_by_prod_date.get((prod.id, r.date), 0.0)
                if tap > 0:
                    enriched[r.id] = tap

        demands, dates = build_product_demand_series(ids_and_dates, enriched)
        n_data = len(demands)

        if n_data < MIN_PRODUCT_RECORDS:
            n_need = MIN_PRODUCT_RECORDS - n_data
            if n_data == 0:
                msg = (
                    f"No sales recorded for {prod.name} yet. "
                    f"Log some sales to see a demand forecast."
                )
            else:
                msg = (
                    f"Log about {n_need} more day{'s' if n_need != 1 else ''} "
                    f"of {prod.name} sales for a reliable forecast "
                    f"({n_data} recorded so far)."
                )
            # Services have no stock concept; skip stock fields for them.
            if prod_type == "service":
                result.append(ProductForecastItem(
                    product_id=prod.id, name=prod.name, unit=prod.unit,
                    product_type=prod_type,
                    status="not_enough_data", message=msg,
                    lead_time_days=prod.lead_time_days,
                    n_days_data=n_data,
                ))
            else:
                ne_proj, ne_untracked = _compute_projected_stock(
                    db, biz.id, prod, today, tap_by_prod_date, assume_on_time=assume_on_time
                )
                result.append(ProductForecastItem(
                    product_id=prod.id, name=prod.name, unit=prod.unit,
                    product_type=prod_type,
                    status="not_enough_data", message=msg,
                    lead_time_days=prod.lead_time_days,
                    current_stock=prod.current_stock,
                    projected_stock=ne_proj,
                    stock_untracked=ne_untracked,
                    n_days_data=n_data,
                ))
            continue

        # ── ensemble forecast ─────────────────────────────────────────────────
        prod_wds = [d.weekday() for d in dates]
        holdout = _holdout_errors(demands, prod_wds, dates, n_per_weekday=4)

        forecast_days: list[ProductForecastDay] = []
        for offset in range(1, 8):
            target = today + timedelta(days=offset)
            wd = target.weekday()
            if open_days is not None and wd not in open_days:
                continue

            preds: dict[str, float] = {}
            maes: dict[str, float] = {}

            try:
                _sn = seasonal_naive_forecast(demands, prod_wds, wd)
                errs = holdout["seasonal_naive"].get(wd, [])
                if errs:
                    preds["seasonal_naive"] = _sn
                    maes["seasonal_naive"] = mad([abs(e) for e in errs])
            except ValueError:
                pass

            p = _wma_for_weekday(demands, prod_wds, wd)
            if p is not None:
                errs = holdout["wma"].get(wd, [])
                if errs:
                    preds["wma"] = p
                    maes["wma"] = mad([abs(e) for e in errs])

            p = _exp_for_weekday(demands, prod_wds, wd)
            if p is not None:
                errs = holdout["exp_smoothing"].get(wd, [])
                if errs:
                    preds["exp_smoothing"] = p
                    maes["exp_smoothing"] = mad([abs(e) for e in errs])

            p = _linear_trend_for_weekday(demands, prod_wds, wd)
            if p is not None:
                errs = holdout["linear_trend"].get(wd, [])
                if errs:
                    same_wd = [v for v, w in zip(demands, prod_wds) if w == wd]
                    preds["linear_trend"] = _cap_linear_trend(p, same_wd)
                    maes["linear_trend"] = mad([abs(e) for e in errs])

            p = year_over_year_forecast(dates, demands, target)
            if p is not None:
                errs = holdout["year_over_year"].get(wd, [])
                if errs:
                    preds["year_over_year"] = p
                    maes["year_over_year"] = mad([abs(e) for e in errs])

            if not preds:
                continue

            weights = model_weights(list(maes.values()))
            fval = max(0.0, blend(list(preds.values()), weights))

            all_wd_errs: list[float] = []
            for model_name in preds:
                all_wd_errs.extend(holdout[model_name].get(wd, []))

            lo, hi = prediction_interval(fval, all_wd_errs) if len(all_wd_errs) >= 2 else (fval, fval)

            unit_mode_f = getattr(prod, "unit_mode", "whole") or "whole"
            forecast_days.append(ProductForecastDay(
                date=target,
                weekday=target.strftime("%A"),
                predicted_units=_round_qty(fval, unit_mode_f),
                interval_low=_round_qty(max(0.0, lo), unit_mode_f),
                interval_high=_round_qty(max(0.0, hi), unit_mode_f),
            ))

        # ── ordering advice (forecast-based, stocked only) ───────────────────
        avg_daily = mean(demands)
        unit_mode = getattr(prod, "unit_mode", "whole") or "whole"

        if prod_type == "service":
            # Services are performed, not held — demand is still forecast but there
            # is no stock, no reorder point, and no ordering advice.
            result.append(ProductForecastItem(
                product_id=prod.id,
                name=prod.name,
                unit=prod.unit,
                product_type=prod_type,
                unit_mode=unit_mode,
                status="ok",
                days=forecast_days,
                avg_daily_demand=_round_qty(avg_daily, unit_mode),
                lead_time_days=prod.lead_time_days,
                n_days_data=n_data,
                # Explicitly no stock or reorder fields for services
                current_stock=None,
                projected_stock=None,
                stock_untracked=False,
                order_now=False,
                approaching_reorder=False,
                suggested_order_qty=0.0,
            ))
            continue

        sigma_daily = stdev(demands) if n_data > 1 else 0.0
        sigma_lt = sigma_daily * math.sqrt(prod.lead_time_days)
        ss = safety_stock(z, sigma_lt)

        # Demand over lead time: use forecast mean if available, else historical mean
        avg_forecast = mean([d.predicted_units for d in forecast_days]) if forecast_days else avg_daily
        forecast_demand_lt = avg_forecast * prod.lead_time_days
        rop = forecast_demand_lt + ss

        eoq_val: float | None = None
        base_qty = forecast_demand_lt + ss

        # ── projected stock (dynamic: baseline − sales + arrivals) ────────────
        proj_stock, stock_untracked = _compute_projected_stock(
            db, biz.id, prod, today, tap_by_prod_date, assume_on_time=assume_on_time
        )
        effective_stock = proj_stock if proj_stock is not None else prod.current_stock

        constrained_qty, cap_notes = apply_order_constraints(
            base_qty,
            storage_capacity=prod.storage_capacity,
            current_stock=effective_stock,
            shelf_life_days=prod.shelf_life_days,
            avg_daily_demand=avg_daily,
        )
        suggested_qty = _round_qty(constrained_qty, unit_mode)
        order_now = (
            not stock_untracked and
            effective_stock is not None and
            effective_stock <= rop
        )
        approaching_reorder = (
            not stock_untracked and
            effective_stock is not None and
            effective_stock > rop and
            effective_stock <= rop + avg_daily * prod.lead_time_days
        )

        # ── projected stock runout warning (future projection) ────────────────
        runout_warning = False
        if effective_stock is not None and not stock_untracked and avg_daily > 0 and forecast_days:
            pending_orders = (
                db.query(OrderRecord)
                .filter_by(business_id=biz.id, product_id=prod.id, status="pending")
                .all()
            )
            arrivals: list[tuple[int, float]] = []
            for o in pending_orders:
                offset = (o.expected_arrival_date - today).days
                if offset >= 0:
                    arrivals.append((offset, o.quantity))
            depletion = [d.predicted_units for d in forecast_days]
            future = projected_stock_timeline(max(0.0, effective_stock), depletion, arrivals)
            runout_warning = will_stock_run_out(future)

        rounded_proj = _round_qty(proj_stock, unit_mode) if proj_stock is not None else None

        result.append(ProductForecastItem(
            product_id=prod.id,
            name=prod.name,
            unit=prod.unit,
            product_type=prod_type,
            unit_mode=unit_mode,
            status="ok",
            days=forecast_days,
            avg_daily_demand=_round_qty(avg_daily, unit_mode),
            forecast_demand_over_lead_time=_round_qty(forecast_demand_lt, unit_mode),
            lead_time_days=prod.lead_time_days,
            safety_stock_units=_round_qty(ss, unit_mode),
            reorder_point=_round_qty(rop, unit_mode),
            suggested_order_qty=suggested_qty,
            current_stock=prod.current_stock,
            projected_stock=rounded_proj,
            stock_untracked=stock_untracked,
            approaching_reorder=approaching_reorder,
            order_now=order_now,
            eoq=eoq_val,
            n_days_data=n_data,
            constraint_notes=cap_notes,
            projected_runout_warning=runout_warning,
        ))

    return ProductForecastResponse(status="ok", products=result)


# ── /hourly-by-weekday ────────────────────────────────────────────────────────

MIN_WEEKDAY_HOURLY = 2  # minimum same-weekday days before a per-weekday profile is shown


@router.get("/hourly-by-weekday", response_model=WeekdayHourlyResponse)
def get_hourly_by_weekday(
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Per-weekday hourly profiles for busy-hours-tomorrow and the weekday peak chart.

    Returns:
    - weekdays: one entry per weekday that has >= MIN_WEEKDAY_HOURLY days of tap data.
    - overall_fallback: all-days average, used when a specific weekday has no entry yet.
    The frontend picks tomorrow's weekday from 'weekdays'; if absent it falls back to
    overall_fallback, labelling it honestly as 'typical across all days'.
    """
    settings = biz.settings or {}
    avg_svc = float(settings.get("avg_service_time_minutes", 5.0))
    open_hours = compute_open_hours(settings)
    tz_name: str = settings.get("timezone", "UTC")

    events = (
        db.query(SaleEvent)
        .filter_by(business_id=biz.id)
        .order_by(SaleEvent.timestamp)
        .all()
    )

    if not events:
        return WeekdayHourlyResponse(
            status="not_enough_data",
            message='No tap data yet. Use "Record a Sale" to log customers — '
                    f'hourly patterns appear after {MIN_HOURLY_DAYS} days of data.',
        )

    raw = [
        (lt.date(), lt.hour, e.product_id, e.quantity)
        for e in events
        for lt in [utc_to_local_dt(e.timestamp, tz_name)]
    ]
    n_days_total = len({ev[0] for ev in raw})

    if n_days_total < MIN_HOURLY_DAYS:
        return WeekdayHourlyResponse(
            status="not_enough_data",
            message=(
                f"Need {MIN_HOURLY_DAYS} days of tap data "
                f"({n_days_total} so far). Keep logging."
            ),
            n_days_total=n_days_total,
        )

    products_list = db.query(Product).filter_by(business_id=biz.id).all()
    svc_by_pid: dict[int, float | None] = {p.id: p.service_time_minutes for p in products_list}

    def _build_slots(ev_subset: list) -> list[WeekdayHourlySlot]:
        avgs = hourly_averages(ev_subset, open_hours)
        mix = hourly_product_mix(ev_subset, open_hours)
        slots: list[WeekdayHourlySlot] = []
        for hour, avg_taps_raw, _ in avgs:
            avg_taps_int = int(round(avg_taps_raw))  # customers are whole people
            hour_mix = mix.get(hour, {})
            pairs = [(qty, svc_by_pid.get(pid)) for pid, qty in hour_mix.items()]
            eff_svc = effective_service_time(pairs, avg_svc) if pairs else avg_svc
            staff = _recommended_staff(avg_taps_raw, eff_svc, settings)
            slots.append(WeekdayHourlySlot(
                hour=hour,
                avg_taps=avg_taps_int,
                recommended_staff=staff,
                label=_fmt_hour_range(hour),
                expected_wait_minutes=round(expected_wait_minutes(avg_taps_raw, eff_svc, staff), 1),
                marginal_note=marginal_note(avg_taps_raw, eff_svc, staff),
            ))
        return slots

    overall_fallback = _build_slots(raw)

    days_per_wd: dict[int, set] = {i: set() for i in range(7)}
    for day, _h, _p, _q in raw:
        days_per_wd[day.weekday()].add(day)

    weekday_entries: list[WeekdayHourlyEntry] = []
    for wd_idx, wd_name in enumerate(_WD_NAMES):
        n_wd = len(days_per_wd[wd_idx])
        if n_wd < MIN_WEEKDAY_HOURLY:
            continue
        wd_raw = [ev for ev in raw if ev[0].weekday() == wd_idx]
        slots = _build_slots(wd_raw)
        if not slots:
            continue
        peak = max(slots, key=lambda s: s.avg_taps)
        weekday_entries.append(WeekdayHourlyEntry(
            weekday=wd_name,
            weekday_idx=wd_idx,
            peak_hour=peak.hour,
            peak_avg_taps=peak.avg_taps,
            n_days_data=n_wd,
            hours=slots,
        ))

    return WeekdayHourlyResponse(
        status="ok",
        weekdays=weekday_entries,
        overall_fallback=overall_fallback,
        n_days_total=n_days_total,
    )


# ── /insights ─────────────────────────────────────────────────────────────────

@router.get("/insights", response_model=InsightsResponse)
def get_insights(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    """True, derived facts about the owner's business from their accumulated data.

    Returns only insights the data actually supports — never fabricates numbers.
    Each field is None when data is insufficient, so the frontend can show an
    honest "keep logging" message for that section instead of a fabricated value.
    """
    today = date.today()

    all_records = (
        db.query(DayRecord)
        .filter_by(business_id=biz.id)
        .order_by(DayRecord.date)
        .all()
    )
    if not all_records:
        return InsightsResponse(
            status="not_enough_data",
            message="No data logged yet. Start logging and insights will appear here.",
        )

    # ── Data volume ───────────────────────────────────────────────────────────
    months_seen = {(r.date.year, r.date.month) for r in all_records}
    n_months = len(months_seen)
    first_date = all_records[0].date
    last_date = all_records[-1].date

    clean_records = _clean_records(db, biz)
    n_clean = len(clean_records)

    # ── Day-of-week patterns ──────────────────────────────────────────────────
    busiest_day_out: InsightsDayPattern | None = None
    slowest_day_out: InsightsDayPattern | None = None
    pct_diff: float | None = None

    if n_clean >= 7:
        obs = _effective_obs(clean_records)
        by_wd: dict[int, list[float]] = {i: [] for i in range(7)}
        for r, v in zip(clean_records, obs):
            by_wd[r.date.weekday()].append(v)

        valid_wds = {wd: vals for wd, vals in by_wd.items() if len(vals) >= 2}
        if len(valid_wds) >= 2:
            overall_mean = mean(obs)
            wd_avgs = {wd: mean(vals) for wd, vals in valid_wds.items()}

            max_wd = max(wd_avgs, key=lambda x: wd_avgs[x])
            min_wd = min(wd_avgs, key=lambda x: wd_avgs[x])
            max_avg = wd_avgs[max_wd]
            min_avg = wd_avgs[min_wd]

            busiest_pct = round((max_avg - overall_mean) / overall_mean * 100, 1) if overall_mean > 0 else 0.0
            slowest_pct = round((min_avg - overall_mean) / overall_mean * 100, 1) if overall_mean > 0 else 0.0

            busiest_day_out = InsightsDayPattern(
                weekday=_WD_NAMES[max_wd],
                avg_customers=round(max_avg, 1),
                pct_vs_mean=busiest_pct,
            )
            slowest_day_out = InsightsDayPattern(
                weekday=_WD_NAMES[min_wd],
                avg_customers=round(min_avg, 1),
                pct_vs_mean=slowest_pct,
            )
            if min_avg > 0:
                pct_diff = round((max_avg - min_avg) / min_avg * 100, 1)

    # ── Hourly patterns ───────────────────────────────────────────────────────
    peak_hour_out: InsightsHourPattern | None = None
    quietest_hour_out: InsightsHourPattern | None = None

    settings = biz.settings or {}
    open_hours = compute_open_hours(settings)
    events = (
        db.query(SaleEvent)
        .filter_by(business_id=biz.id)
        .order_by(SaleEvent.timestamp)
        .all()
    )
    if events:
        n_days_taps = len({e.timestamp.date() for e in events})
        if n_days_taps >= MIN_HOURLY_DAYS:
            raw = [(e.timestamp.date(), e.timestamp.hour, e.product_id, e.quantity)
                   for e in events]
            avgs = hourly_averages(raw, open_hours)
            active_slots = [(h, avg, n) for h, avg, n in avgs if avg > 0]
            if active_slots:
                peak = max(active_slots, key=lambda x: x[1])
                quiet = min(active_slots, key=lambda x: x[1])
                peak_hour_out = InsightsHourPattern(
                    hour=peak[0],
                    label=_fmt_hour_range(peak[0]),
                    avg_taps=round(peak[1], 1),
                )
                if quiet[0] != peak[0]:
                    quietest_hour_out = InsightsHourPattern(
                        hour=quiet[0],
                        label=_fmt_hour_range(quiet[0]),
                        avg_taps=round(quiet[1], 1),
                    )

    # ── Year-over-year ────────────────────────────────────────────────────────
    yoy_growth_pct: float | None = None
    yoy_prev_label: str | None = None
    yoy_curr_label: str | None = None

    data_span_days = (last_date - first_date).days
    if data_span_days >= 365 and n_clean >= 28:
        obs_c = _effective_obs(clean_records)
        month_data: dict[tuple[int, int], list[float]] = {}
        for r, v in zip(clean_records, obs_c):
            month_data.setdefault((r.date.year, r.date.month), []).append(v)

        yoy_pairs = []
        for (yr, mo), vals in month_data.items():
            prev_key = (yr - 1, mo)
            if prev_key in month_data:
                yoy_pairs.append(((yr - 1, mo), (yr, mo),
                                  mean(month_data[prev_key]), mean(vals)))

        if yoy_pairs:
            latest = max(yoy_pairs, key=lambda x: (x[1][0], x[1][1]))
            prev_avg, curr_avg = latest[2], latest[3]
            if prev_avg > 0:
                yoy_growth_pct = round((curr_avg - prev_avg) / prev_avg * 100, 1)
                yoy_prev_label = f"{_MONTH_NAMES[latest[0][1]-1]} {latest[0][0]}"
                yoy_curr_label = f"{_MONTH_NAMES[latest[1][1]-1]} {latest[1][0]}"

    # ── Forecast accuracy ─────────────────────────────────────────────────────
    forecast_accuracy_mape: float | None = None
    accuracy_early_mape: float | None = None
    accuracy_recent_mape: float | None = None
    accuracy_improved: bool | None = None

    # Build list of (predicted, actual) pairs from stored ForecastRun history
    past_runs = (
        db.query(ForecastRun)
        .filter_by(business_id=biz.id)
        .filter(ForecastRun.target_date < today)
        .order_by(ForecastRun.target_date)
        .all()
    )
    actual_map: dict[date, int] = {
        r.date: r.customers
        for r in db.query(DayRecord).filter_by(business_id=biz.id).all()
    }

    matched: list[tuple[float, float]] = []
    seen_d: set[date] = set()
    for fr in past_runs:
        if fr.target_date in seen_d:
            continue
        seen_d.add(fr.target_date)
        actual = actual_map.get(fr.target_date)
        if actual is None:
            continue
        matched.append((float(fr.predicted_value), float(actual)))

    if len(matched) >= 4:
        try:
            all_preds_m = [x[0] for x in matched]
            all_acts_m  = [x[1] for x in matched]
            forecast_accuracy_mape = round(mape(all_acts_m, all_preds_m), 1)
        except ValueError:
            pass

    if len(matched) >= 14:
        half = len(matched) // 2
        early = matched[:half]
        recent = matched[-half:]
        try:
            em = mape([x[1] for x in early], [x[0] for x in early])
            rm = mape([x[1] for x in recent], [x[0] for x in recent])
            accuracy_early_mape = round(em, 1)
            accuracy_recent_mape = round(rm, 1)
            accuracy_improved = rm < em
        except ValueError:
            pass

    # Fallback: no stored ForecastRun data yet — compute holdout accuracy from
    # DayRecords so the insights view shows real numbers instead of "log more weeks".
    if forecast_accuracy_mape is None and n_clean >= MIN_RECORDS:
        holdout_obs = _effective_obs(clean_records)
        holdout_wds = [r.date.weekday() for r in clean_records]
        n_eval = min(90, len(holdout_obs) - 7)
        if n_eval > 0:
            h_acts: list[float] = []
            h_preds: list[float] = []
            for i in range(len(holdout_obs) - n_eval, len(holdout_obs)):
                try:
                    p = seasonal_naive_forecast(holdout_obs[:i], holdout_wds[:i], holdout_wds[i])
                    h_acts.append(holdout_obs[i])
                    h_preds.append(p)
                except ValueError:
                    pass
            if len(h_acts) >= 4:
                try:
                    forecast_accuracy_mape = round(mape(h_acts, h_preds), 1)
                except ValueError:
                    pass

    return InsightsResponse(
        status="ok",
        n_days_logged=len(all_records),
        n_months_logged=n_months,
        first_date=first_date,
        last_date=last_date,
        busiest_day=busiest_day_out,
        slowest_day=slowest_day_out,
        pct_diff_busiest_slowest=pct_diff,
        peak_hour=peak_hour_out,
        quietest_hour=quietest_hour_out,
        yoy_growth_pct=yoy_growth_pct,
        yoy_prev_period_label=yoy_prev_label,
        yoy_curr_period_label=yoy_curr_label,
        forecast_accuracy_mape=forecast_accuracy_mape,
        accuracy_early_mape=accuracy_early_mape,
        accuracy_recent_mape=accuracy_recent_mape,
        accuracy_improved=accuracy_improved,
    )

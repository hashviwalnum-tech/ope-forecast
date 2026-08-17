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

from app import clock
from app.api.day_records import rollup_tap_days
from app.api.deps import get_business
from app.db import get_db
from app.engine.accuracy import detect_drift, forecast_errors, mad, mape, mse, tracking_signal
from app.engine.booking import booking_forecast, fit_booking_regression
from app.engine.limits import history_cutoff
from app.engine.monthly import monthly_summary
from app.engine.ensemble import (
    MIN_ERRORS_FOR_QUANTILES,
    blend,
    debias,
    model_weights,
    prediction_interval,
)
from app.engine.forecasting import (
    MIN_EARLY_OBSERVATIONS,
    early_forecast,
    exponential_smoothing,
    linear_trend,
    year_over_year_forecast,
    weighted_moving_average,
)
from app.engine.live_sales import (
    compute_open_hours,
    hourly_averages,
    hourly_product_mix,
    service_minutes_per_customer,
    utc_to_local_dt,
)
from app.engine.ordering import (
    BatchInfo,
    apply_order_constraints,
    batches_expiring_before,
    compute_current_projected_stock,
    economic_order_quantity,
    fifo_deplete,
    projected_stock_timeline,
    order_up_to_target,
    reorder_point,
    reorder_point_exceeds_capacity,
    safety_stock,
    service_level_z,
    spoiled_or_at_risk,
    total_remaining,
    will_stock_run_out,
)
from app.engine.outliers import detect_outliers
from app.engine.promo_uplift import uplift_for_day
from app.engine.product_forecast import build_product_demand_series, round_qty
from app.engine.queueing import (
    effective_service_time,
    expected_wait_minutes,
    marginal_note,
    marginal_waits,
    min_servers,
    min_servers_for_queue_threshold,
    min_servers_for_wait_threshold,
    queue_length,
)
from app.engine.seasonality import seasonal_naive_forecast
from app.models import BookedCount, Business, DayRecord, ForecastRun, Period, Product, Regular, RegularDailySpend, SaleEvent, SaleRecord, ServiceBookedCount
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
    InsightsDecliningRegular,
    InsightsHourPattern,
    InsightsResponse,
    InsightsSeasonalAlert,
    InsightsWeekdayTrend,
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
# Same-weekday holdout errors used to judge each model.  Four was far too few:
# replaying the simulated year, a 4-point window picked the model that was truly
# best on that weekday only 42.9% of the time (chance is 25%), so the weights
# were mostly reacting to noise.  Twelve is the same window the bias check uses.
_WEIGHT_WINDOW = 12
_BIAS_WINDOW = 12    # longer window used only to judge whether a model is biased
_BAND_HISTORY_DAYS = 120  # realised track record used to size the prediction band


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
            # Bounded at today, exactly as arrivals are.  Without this, a single
            # day record dated in the future subtracts its sales with no matching
            # delivery and silently drags projected stock down forever.
            DayRecord.date <= today,
        )
        .all()
    )
    sales_since = sum(float(r[0]) for r in rows)
    sale_record_dates: set[date] = {r[1] for r in rows}

    # Also count live taps (SaleEvents) on days that have no manual SaleRecord
    if tap_by_prod_date is not None:
        for (pid, d), qty in tap_by_prod_date.items():
            if pid == prod.id and baseline_date < d <= today and d not in sale_record_dates:
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
                DayRecord.date <= today,
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
    cutoff = history_cutoff(biz.tier, clock.today_local(biz.settings))

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


def _history_records(db: Session, biz: Business) -> list[DayRecord]:
    """Every day the owner logged, for history and trends views.

    Unlike ``_clean_records`` this keeps days inside tagged ad/event periods —
    they really happened and belong in the owner's own history.  It still drops
    days the owner explicitly marked as a fluke to ignore, and weekdays the
    business is closed, and it never invents a missing day.
    """
    rollup_tap_days(db, biz)
    open_days = _open_days(biz)
    cutoff = history_cutoff(biz.tier, clock.today_local(biz.settings))
    query = db.query(DayRecord).filter_by(business_id=biz.id)
    if cutoff is not None:
        query = query.filter(DayRecord.date >= cutoff)
    return [
        r for r in query.order_by(DayRecord.date).all()
        if r.outlier_status != "excluded"
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


def _booking_forecast_for_date(
    dates: list[date],
    obs: list[float],
    booked_by_date: dict[date, int],
    target_date: date,
) -> float | None:
    """Predict target_date's total demand from its booked-appointment count.

    Fits the booking regression (app/engine/booking.py) on historical
    (booked, actual) pairs strictly before target_date, then applies it to
    target_date's booked count. Returns None when target_date has no booked
    count recorded, or there isn't yet enough paired history to fit —
    exactly the same "earn your weight" thin-data guard as every other model.
    """
    if target_date not in booked_by_date:
        return None
    pair_bookings: list[float] = []
    pair_actuals: list[float] = []
    for d, o in zip(dates, obs):
        if d < target_date and d in booked_by_date:
            pair_bookings.append(booked_by_date[d])
            pair_actuals.append(o)
    fit = fit_booking_regression(pair_bookings, pair_actuals)
    if fit is None:
        return None
    slope, intercept = fit
    return booking_forecast(booked_by_date[target_date], slope, intercept)


def _holdout_errors(
    obs: list[float],
    wds: list[int],
    dates: list[date] | None = None,
    n_per_weekday: int = 4,
    booked_by_date: dict[date, int] | None = None,
) -> dict[str, dict[int, list[float]]]:
    """Leave-one-out signed errors (actual − predicted) for each model and weekday.

    For each weekday, the last n_per_weekday occurrences are treated as a holdout.
    Each point is predicted using only data that came before it in time.

    Models: seasonal_naive, wma, exp_smoothing, linear_trend, year_over_year,
    booking. year_over_year requires dates; booking requires dates AND
    booked_by_date. Both produce no errors when their required data is absent.
    """
    result: dict[str, dict[int, list[float]]] = {
        "seasonal_naive": {},
        "wma": {},
        "exp_smoothing": {},
        "linear_trend": {},
        "year_over_year": {},
        "booking": {},
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
        bk_e: list[float] = []

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

                if booked_by_date:
                    p = _booking_forecast_for_date(t_dates, t_obs, booked_by_date, dates[hi])
                    if p is not None:
                        bk_e.append(actual - p)

        result["seasonal_naive"][wd] = sn
        result["wma"][wd] = wma_e
        result["exp_smoothing"][wd] = exp_e
        result["linear_trend"][wd] = lt_e
        result["year_over_year"][wd] = yoy_e
        result["booking"][wd] = bk_e

    return result


def _completed_period_ratios(
    db: Session, biz: Business, today: date
) -> tuple[dict[str, list[float]], dict[tuple[str, int], list[float]]]:
    """actual ÷ baseline for each of this business's FINISHED promotions, by type.

    This is deliberately the same measurement the Lift screen shows the owner —
    what really happened over the period against what the model says a normal
    stretch of those weekdays would have produced.  Feeding the forecast from
    the same number means the two can never disagree.

    Only periods that have ended are used (a promotion still running has not
    finished proving itself), and only ones with enough surrounding history to
    build a baseline at all.

    Returns (ratios_by_type, ratios_by_type_and_weekday).  The second is the
    same measurements split by weekday, because a promotion mostly rescues the
    quiet days: one pooled figure left Sunday promo days under-forecast by 152
    customers each while weekdays were nearly right.
    """
    ratios: dict[str, list[float]] = {}
    by_wd: dict[tuple[str, int], list[float]] = {}
    periods = db.query(Period).filter_by(business_id=biz.id).all()
    finished = [p for p in periods if p.end_date < today]
    if not finished:
        return ratios, by_wd

    all_records = (
        db.query(DayRecord).filter_by(business_id=biz.id).order_by(DayRecord.date).all()
    )
    open_days = _open_days(biz)
    blocked: set[date] = set()
    for p in periods:
        d = p.start_date
        while d <= p.end_date:
            blocked.add(d)
            d += timedelta(days=1)

    # Training set = every clean day OUTSIDE any tagged period.
    train = [
        r for r in all_records
        if r.date not in blocked
        and r.outlier_status not in ("excluded", "event")
        and (open_days is None or r.date.weekday() in open_days)
    ]
    if len(train) < MIN_RECORDS:
        return ratios, by_wd
    train_obs = _effective_obs(train)
    train_wds = [r.date.weekday() for r in train]

    for p in finished:
        during = [
            r for r in all_records
            if p.start_date <= r.date <= p.end_date
            and r.outlier_status not in ("excluded",)
            and (open_days is None or r.date.weekday() in open_days)
        ]
        if not during:
            continue
        actual = 0.0
        baseline = 0.0
        ok = True
        for r in during:
            try:
                day_base = seasonal_naive_forecast(train_obs, train_wds, r.date.weekday())
            except ValueError:
                ok = False
                break
            if day_base > 0:
                # Per-DAY ratio as well as the period total, so the weekday
                # split has something to learn from.
                by_wd.setdefault((p.type, r.date.weekday()), []).append(
                    float(r.customers) / day_base
                )
            actual += float(r.customers)
            baseline += day_base
        if not ok or baseline <= 0:
            continue
        ratios.setdefault(p.type, []).append(actual / baseline)
    return ratios, by_wd


def _active_period_types(db: Session, biz: Business, target: date) -> list[str]:
    """Which promo types the owner has tagged as running on a given date."""
    return sorted({
        p.type for p in db.query(Period).filter_by(business_id=biz.id).all()
        if p.start_date <= target <= p.end_date
    })


def _compute_holdout_mape(obs: list[float], wds: list[int]) -> float | None:
    """Holdout MAPE: leave-one-out on the last ≤90 observations.

    Identical algorithm to the /accuracy endpoint so both surfaces show the
    same number.  Returns None when data is insufficient or all actuals are zero.
    """
    n_eval = min(90, len(obs) - 7)
    if n_eval <= 0:
        return None
    acts: list[float] = []
    preds: list[float] = []
    for i in range(len(obs) - n_eval, len(obs)):
        try:
            p = seasonal_naive_forecast(obs[:i], wds[:i], wds[i])
            acts.append(obs[i])
            preds.append(p)
        except ValueError:
            pass
    if len(acts) < 4:
        return None
    try:
        return round(mape(acts, preds), 1)
    except ValueError:
        return None


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

    # Auto-resolve stale flags: candidate days previously flagged that the wider
    # reference set no longer considers extreme.  Only runs when detection executed;
    # if the reference was too small, existing flags are left untouched.
    if len(ref_records) >= MIN_RECORDS:
        for r in all_records:
            if r.outlier_status == "flagged" and r.id in candidate_ids and r.id not in detected_by_id:
                r.outlier_status = None
                changed = True

    # Flag newly detected records (only in detection set, only unreviewed)
    for r in det_records:
        if r.outlier_status is None and r.id in detected_by_id:
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

def _learning_forecast(db: Session, biz: Business, records: list[DayRecord]) -> ForecastResponse:
    """The first-fortnight forecast: honest, wide, and clearly still learning.

    A brand-new owner used to see "not enough data" on every screen for two
    solid weeks, which gives them no reason to keep logging.  From the second
    logged day onward they now get a range instead — with status='learning' so
    the client can label it plainly and lead with the range rather than a
    falsely confident single number.  The ordering recommendation stays behind
    the full MIN_RECORDS gate: a range is useful, a wrong order quantity costs
    real money.
    """
    obs = _effective_obs(records)
    wds = [r.date.weekday() for r in records]
    today = clock.today_local(biz.settings)
    open_days = _open_days(biz)

    days: list[ForecastDay] = []
    for offset in range(1, 8):
        target_date = today + timedelta(days=offset)
        wd = target_date.weekday()
        if open_days is not None and wd not in open_days:
            continue
        band = early_forecast(obs, wds, wd)
        if band is None:
            continue
        lo, hi = band
        days.append(ForecastDay(
            date=target_date,
            weekday=target_date.strftime("%A"),
            predicted_customers=round((lo + hi) / 2),
            interval_low=max(0, round(lo)),
            interval_high=max(0, round(hi)),
            model_weights={},
        ))

    if not days:
        return ForecastResponse(
            status="not_enough_data",
            message=f"Need at least {MIN_EARLY_OBSERVATIONS} logged days before "
                    f"Ope can estimate anything ({len(records)} so far). Keep logging.",
            days=[],
        )

    return ForecastResponse(
        status="learning",
        message=f"Still learning — this is a rough range from your first "
                f"{len(records)} day{'s' if len(records) != 1 else ''}. "
                f"Accuracy improves a lot after about two weeks of logging.",
        days=days,
        days_logged=len(records),
        days_needed=MIN_RECORDS,
    )


@router.get("/forecast", response_model=ForecastResponse)
def get_forecast(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    records = _clean_records(db, biz)

    if len(records) < MIN_RECORDS:
        return _learning_forecast(db, biz, records)

    obs = _effective_obs(records)
    wds = [r.date.weekday() for r in records]
    dates = [r.date for r in records]

    # Booking-aware demand (spec: appointment businesses) — off by default,
    # a per-business setting. When on, blend owner-recorded booked-appointment
    # counts into the ensemble like every other model, weighted by its own
    # holdout accuracy so it only earns influence once it's proven itself.
    booked_by_date: dict[date, int] = {}
    if (biz.settings or {}).get("appointment_based"):
        booked_by_date = {
            r.date: r.booked_count
            for r in db.query(BookedCount).filter_by(business_id=biz.id).all()
        }
        # Per-service detail is more granular than the whole-business total —
        # when a date has any per-service entries, sum them across services and
        # prefer that sum over the whole-business figure for that date (avoids
        # double-counting; falls back to the whole-business entry otherwise).
        svc_sum_by_date: dict[date, int] = {}
        for r in db.query(ServiceBookedCount).filter_by(business_id=biz.id).all():
            svc_sum_by_date[r.date] = svc_sum_by_date.get(r.date, 0) + r.booked_count
        booked_by_date.update(svc_sum_by_date)

    # A longer holdout window than the ensemble weights use.  The MAE weighting
    # only needs the most recent behaviour, but telling a genuine systematic lag
    # apart from noise needs more evidence: with four points the "bias" is mostly
    # noise, and correcting it measurably hurt accuracy (10.14% -> 10.60% MAPE).
    holdout = _holdout_errors(obs, wds, dates, n_per_weekday=_BIAS_WINDOW,
                              booked_by_date=booked_by_date or None)

    today = clock.today_local(biz.settings)
    open_days = _open_days(biz)
    days: list[ForecastDay] = []

    # The owner has already told us which days have an ad or event on them.
    # Tagged days are (rightly) kept out of the training baseline, so without
    # this the forecast for a promo day is the forecast for an ordinary day —
    # low on every single one, and the ordering advice low with it.
    period_ratios, period_ratios_by_wd = _completed_period_ratios(db, biz, today)

    # The band is sized from Ope's OWN realised track record — the difference
    # between what it actually predicted and what actually happened, from the
    # stored forecast log — rather than from the individual models' holdout
    # errors.  Holdout errors describe each model in isolation on the data it was
    # fitted around; they measured out noticeably tighter than the blend's real
    # forward error, which is why the first attempt at an 80% band only achieved
    # 66.7% coverage.  Realised residuals are the honest answer to "how far out
    # is this app, in practice, on days like this one".
    # Split by promo status as well as weekday: a promo day is measurably less
    # predictable for this app (band 132 vs a true spread of 247 when they were
    # pooled together), so it deserves its own, wider band rather than borrowing
    # an ordinary day's.
    _promo_dates: set[date] = set()
    for _p in db.query(Period).filter_by(business_id=biz.id).all():
        _d0 = _p.start_date
        while _d0 <= _p.end_date:
            _promo_dates.add(_d0)
            _d0 += timedelta(days=1)

    realised_by_key: dict[tuple[int, bool], list[float]] = {}
    realised_by_promo: dict[bool, list[float]] = {True: [], False: []}
    realised_all: list[float] = []
    for _d, _actual, _pred in _scored_forecasts(db, biz, records, limit=_BAND_HISTORY_DAYS):
        _err = _actual - _pred
        _was_promo = _d in _promo_dates
        realised_by_key.setdefault((_d.weekday(), _was_promo), []).append(_err)
        realised_by_promo[_was_promo].append(_err)
        realised_all.append(_err)

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
                maes["seasonal_naive"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])
        except ValueError:
            pass

        p = _wma_for_weekday(obs, wds, wd)
        if p is not None:
            errs = holdout["wma"].get(wd, [])
            if errs:
                preds["wma"] = p
                maes["wma"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])

        p = _exp_for_weekday(obs, wds, wd)
        if p is not None:
            errs = holdout["exp_smoothing"].get(wd, [])
            if errs:
                preds["exp_smoothing"] = p
                maes["exp_smoothing"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])

        p = _linear_trend_for_weekday(obs, wds, wd)
        if p is not None:
            errs = holdout["linear_trend"].get(wd, [])
            if errs:
                same_wd = [v for v, w in zip(obs, wds) if w == wd]
                preds["linear_trend"] = _cap_linear_trend(p, same_wd)
                maes["linear_trend"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])

        p = year_over_year_forecast(dates, obs, target_date)
        if p is not None:
            errs = holdout["year_over_year"].get(wd, [])
            if errs:
                preds["year_over_year"] = p
                maes["year_over_year"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])

        if booked_by_date:
            p = _booking_forecast_for_date(dates, obs, booked_by_date, target_date)
            if p is not None:
                errs = holdout["booking"].get(wd, [])
                if errs:
                    preds["booking"] = p
                    maes["booking"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])

        if not preds:
            continue

        # Each model is shifted by its own recent signed error on this weekday
        # before blending.  Inverse-error weighting cannot see bias, so without
        # this a business whose demand is growing gets a forecast that lags —
        # every trailing-average model is low in the same direction and they all
        # keep similar MAEs, so the blend never notices.
        debiased = {
            m: debias(p_val, holdout[m].get(wd, []))
            for m, p_val in preds.items()
        }
        # How much each model was shifted, so the prediction band can be built
        # from the residuals that REMAIN after debiasing rather than the raw
        # errors — otherwise the band re-applies a bias the forecast has already
        # corrected for, and sits offset from the number on screen.
        shifts = {m: debiased[m] - preds[m] for m in preds}

        weights = model_weights(list(maes.values()))
        forecast_val = blend(list(debiased.values()), weights)

        # Scale up (or down) for a promotion the owner has already tagged on this
        # date, by however much their OWN past promotions of that type actually
        # moved the needle.  1.0 — no change — when they have never run one.
        active_types = _active_period_types(db, biz, target_date)
        uplift = uplift_for_day(period_ratios, active_types,
                                ratios_by_type_weekday=period_ratios_by_wd,
                                weekday=wd)
        forecast_val *= uplift

        # Only use errors from models that were actually included in the blend,
        # so unvalidated models' wild holdout errors don't inflate the spread —
        # and use each model's residual AFTER its bias shift, scaled by the same
        # promo uplift the forecast just took, so the band describes the number
        # actually being shown.
        all_wd_errs: list[float] = []
        for model_name in preds:
            shift = shifts.get(model_name, 0.0)
            all_wd_errs.extend(
                (e - shift) * uplift
                for e in holdout[model_name].get(wd, [])[-_WEIGHT_WINDOW:]
            )

        # Like for like, narrowing the comparison only while there is enough of
        # it: this weekday under these conditions, then any day under these
        # conditions, then any day at all, and only for an account with no track
        # record yet, the individual models' holdout errors.
        target_is_promo = bool(active_types)
        band_errs = realised_by_key.get((wd, target_is_promo), [])
        if len(band_errs) < MIN_ERRORS_FOR_QUANTILES:
            band_errs = realised_by_promo[target_is_promo]
        if len(band_errs) < MIN_ERRORS_FOR_QUANTILES:
            band_errs = realised_all
        if len(band_errs) < 2:
            band_errs = all_wd_errs

        if len(band_errs) >= 2:
            lo, hi = prediction_interval(forecast_val, band_errs)
            lo = max(0.0, lo)  # customer counts can't be negative
        else:
            lo, hi = forecast_val, forecast_val

        weights_out = {m: round(w, 4) for m, w in zip(preds.keys(), weights)}
        if uplift != 1.0:
            weights_out["promo_uplift"] = round(uplift, 4)

        pred_int = round(forecast_val)
        lo_int = max(0, round(lo))
        hi_int = max(0, round(hi))

        db.add(ForecastRun(
            business_id=biz.id,
            created_at=clock.now_naive_utc(),
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
            booked_count=booked_by_date.get(target_date),
        ))

    db.commit()
    drift = detect_drift(obs)
    return ForecastResponse(status="ok", days=days, drift_alert=drift)


ACCURACY_WINDOW_DAYS = 90


def _scored_forecasts(
    db: Session, biz: Business, records: list[DayRecord], limit: int | None = ACCURACY_WINDOW_DAYS
) -> list[tuple[date, float, float]]:
    """**The single source of truth for "how did our forecasts do".**

    Returns (date, actual, predicted) for each past day, using the LAST forecast
    made before that day — the one the owner was actually looking at.

    Every surface that shows an accuracy figure must go through here.  Three of
    them used to compute it independently and disagreed: the Accuracy screen
    scored the seasonal-naive model alone (13.7 %), Insights scored the
    seven-days-ahead forecast (11.2 %), and the truth was 10.2 %.  Each was
    individually defensible; together they destroyed any confidence in the
    number.  The ForecastRun table already records every prediction, so it is the
    honest source and there is no reason for anything else to guess.

    Days the owner has not yet reviewed an outlier flag on are excluded, so an
    unreviewed spike cannot make the forecast look bad.
    """
    today = clock.today_local(biz.settings)
    by_date: dict[date, DayRecord] = {
        r.date: r for r in records if r.outlier_status != "flagged"
    }
    if not by_date:
        return []

    runs = (
        db.query(ForecastRun)
        .filter(ForecastRun.business_id == biz.id, ForecastRun.target_date < today)
        .order_by(ForecastRun.target_date, ForecastRun.created_at)
        .all()
    )
    freshest: dict[date, ForecastRun] = {}
    for fr in runs:
        if fr.target_date in by_date:
            freshest[fr.target_date] = fr        # ordered by created_at: last wins

    dates = sorted(freshest)
    if limit is not None:
        dates = dates[-limit:]
    return [
        (d, float(by_date[d].customers), float(freshest[d].predicted_value))
        for d in dates
    ]


def _accuracy_from_forecast_runs(
    db: Session, biz: Business, records: list[DayRecord]
) -> tuple[list[float], list[float], str]:
    """(actuals, predictions, source) — thin wrapper over _scored_forecasts."""
    scored = _scored_forecasts(db, biz, records)
    return [a for _d, a, _p in scored], [p for _d, _a, p in scored], "measured"


def _peak_hours(db: Session, biz: Business) -> list[tuple[int, float, int]]:
    """**The single source of truth for the hourly customer profile.**

    Returns the same (hour, avg_customers, n_days) list the busy-hours chart
    draws, so anything naming a "peak hour" names the same one.  Insights and
    the chart used to compute this separately and could disagree — Insights once
    announced 1–2 pm while the chart's tallest bar was 12–1 pm, because one
    ranked on the raw average and the other on the rounded figure it displayed.
    """
    settings = biz.settings or {}
    open_hours = compute_open_hours(settings)
    tz_name: str = settings.get("timezone", "UTC")
    events = db.query(SaleEvent).filter_by(business_id=biz.id).all()
    if not events:
        return []
    raw = [
        (lt.date(), lt.hour, e.product_id, e.quantity)
        for e in events
        for lt in [utc_to_local_dt(e.timestamp, tz_name)]
    ]
    return hourly_averages(raw, open_hours)


def _peak_and_quiet_hour(
    avgs: list[tuple[int, float, int]]
) -> tuple[tuple[int, float] | None, tuple[int, float] | None]:
    """Busiest and quietest hour from a profile, ranked on the ROUNDED figure the
    chart displays so two screens can never name different hours on a near-tie."""
    active = [(h, avg) for h, avg, _n in avgs if avg > 0]
    if not active:
        return None, None
    peak = max(active, key=lambda x: (round(x[1]), -x[0]))
    quiet = min(active, key=lambda x: (round(x[1]), x[0]))
    return peak, (quiet if quiet[0] != peak[0] else None)



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

    # Score the forecasts Ope ACTUALLY SHOWED, from the stored ForecastRuns.
    # This screen used to evaluate the seasonal-naive model on its own, which is
    # one of four voices in the blend — so it reported the wrong thing, and
    # reported it worse than the truth (13.7% against a real 10.2% over the
    # simulated year).  Every prediction is already recorded; use it.
    actuals, predictions, source = _accuracy_from_forecast_runs(db, biz, records)

    if len(actuals) < 4:
        # Not enough of the owner's own history has been forecast yet (a new
        # account, or one that has not opened the app much).  Fall back to a
        # leave-one-out estimate over the same-weekday history so the screen
        # still says something honest.
        source = "estimated"
        actuals, predictions = [], []
        n_eval = min(90, len(obs) - 7)
        for i in range(len(obs) - n_eval, len(obs)):
            if records[i].outlier_status == "flagged":
                continue  # don't score against unreviewed outlier days
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
        measured_from=source,
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
        # A closed or not-yet-logged weekday has NO data — reporting it as an
        # average of 0.0 customers is the missing-day-is-not-zero rule leaking
        # into the UI, and reads as "we serve nobody on Saturdays".  Omit it.
        if not vals:
            continue
        avg = mean(vals)
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
    today = clock.today_local(biz.settings)
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
                is_favorite=getattr(prod, "is_favorite", False) or False,
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
                n_days_data=0,
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
        unit_mode = getattr(prod, "unit_mode", "whole") or "whole"

        proj_stock, stock_untracked = _compute_projected_stock(db, biz.id, prod, today, assume_on_time=assume_on_time)
        effective_stock = proj_stock if proj_stock is not None else prod.current_stock

        # Order UP TO a target level rather than ordering the trigger amount.
        # Sizing every order to the reorder point replenishes back to the reorder
        # point, so stock hovers at the trigger for ever and never recovers from
        # a bad week.
        target_level, base_qty = order_up_to_target(
            avg_daily, prod.lead_time_days, rop,
            effective_stock if effective_stock is not None else 0.0,
            storage_capacity=prod.storage_capacity,
        )

        constrained_qty, cap_notes, cap_codes = apply_order_constraints(
            base_qty,
            storage_capacity=prod.storage_capacity,
            current_stock=effective_stock,
            shelf_life_days=prod.shelf_life_days,
            avg_daily_demand=avg_daily,
        )
        suggested_qty = _round_qty(constrained_qty, unit_mode)
        order_now = effective_stock is not None and not stock_untracked and effective_stock <= rop
        # Never tell the owner to "order now" and then suggest zero units — that
        # is a contradiction they cannot act on.  When storage leaves no room,
        # the note explains that instead.
        if order_now and suggested_qty <= 0:
            order_now = False
        # A structural warning worth saying out loud: some shops simply cannot
        # hold enough to cover a delivery, so they will hover below the reorder
        # point forever no matter how diligently they order.
        if reorder_point_exceeds_capacity(rop, prod.storage_capacity):
            cap_notes.append(
                f"Your storage holds {_round_qty(prod.storage_capacity, unit_mode):g} "
                f"{prod.unit}, but covering a {prod.lead_time_days}-day delivery needs about "
                f"{_round_qty(rop, unit_mode):g}. Order smaller amounts more often, "
                f"or make more room."
            )
            cap_codes.append({"code": "storage_below_reorder_point", "params": {
                "capacity": _round_qty(prod.storage_capacity, unit_mode),
                "unit": prod.unit,
                "days": prod.lead_time_days,
                "needed": _round_qty(rop, unit_mode),
            }})
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
            is_favorite=getattr(prod, "is_favorite", False) or False,
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
            n_days_data=n_data,
            constraint_notes=cap_notes,
            constraint_codes=cap_codes,
            fifo_note=fifo_n,
            older_stock_warning=older_w,
            spoilage_alert=spoil_a,
        ))

    return OrderingResponse(status="ok", products=result)


# ── /forecast-history ─────────────────────────────────────────────────────────

@router.get("/forecast-history", response_model=ForecastHistoryResponse)
def get_forecast_history(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    today = clock.today_local(biz.settings)

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

    # Shared with Insights via _peak_hours, so the two screens always draw the
    # same profile and name the same busiest hour.
    avgs = _peak_hours(db, biz)

    # Build a product_id → service_time_minutes lookup (None when not set)
    products_list = db.query(Product).filter_by(business_id=biz.id).all()
    svc_by_pid: dict[int, float | None] = {p.id: p.service_time_minutes for p in products_list}
    # Minutes of staff work one CUSTOMER costs in each hour (whole basket, not
    # the per-item average) — the quantity the M/M/c model actually needs.
    svc_by_hour = service_minutes_per_customer(raw, svc_by_pid, avg_svc, open_hours)

    hours: list[HourlySlotAvg] = []
    for hour, avg_taps_raw, n in avgs:
        avg_taps_int = int(round(avg_taps_raw))  # customers are whole people
        eff_svc = svc_by_hour.get(hour, avg_svc)
        staff = _recommended_staff(avg_taps_raw, eff_svc, settings)
        time_range = _fmt_hour_range(hour)
        word = "person" if staff == 1 else "people"
        _wa, _wr = marginal_waits(avg_taps_raw, eff_svc, staff)
        hours.append(HourlySlotAvg(
            hour=hour,
            avg_taps=avg_taps_int,
            n_days=n,
            recommended_staff=staff,
            label=f"For {time_range}, schedule {staff} {word}",
            expected_wait_minutes=round(expected_wait_minutes(avg_taps_raw, eff_svc, staff), 1),
            queue_length=round(queue_length(avg_taps_raw, eff_svc, staff), 2),
            marginal_note=marginal_note(avg_taps_raw, eff_svc, staff),
            wait_if_add=round(_wa, 1) if _wa is not None else None,
            wait_if_remove=round(_wr, 1) if _wr is not None else None,
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
    """Monthly aggregation for the trends & history view.

    This is a HISTORY view — "every day you've logged" — not the forecasting
    baseline, and the two want different data.  It used to reuse the baseline,
    which strips out every day inside a tagged ad or event: on the simulated
    year that silently dropped 55 real trading days, reported "256 days logged"
    where the owner had logged 311, showed those days as gaps in a chart
    captioned "every day you've logged", and drew a monthly trend line for a
    business that had never run any promotions.

    So: every logged day, at its real value.  The two things still honoured are
    the owner's own instructions — days they marked as a fluke to ignore, and
    weekdays they are closed — and missing days stay absent, never zero-filled.
    """
    records = _history_records(db, biz)

    if not records:
        return MonthlyResponse(
            status="not_enough_data",
            message=(
                "No data logged yet. Start adding daily customer counts "
                "and monthly trends will appear here."
            ),
        )

    # Real values, not the median-substituted ones the forecaster uses: a
    # history view should show what actually happened.
    day_data = [(r.date, float(r.customers)) for r in records]

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
    # Bucket by the business's LOCAL calendar day — a tap stored a few hours
    # before UTC midnight belongs to the shop's own day, not the UTC one.
    _tz: str = (biz.settings or {}).get("timezone", "UTC")
    tap_by_prod_date: dict[tuple[int, date], float] = {}
    for se in all_events:
        if se.product_id is None:
            continue
        key = (se.product_id, utc_to_local_dt(se.timestamp, _tz).date())
        tap_by_prod_date[key] = tap_by_prod_date.get(key, 0.0) + se.quantity

    today = clock.today_local(biz.settings)
    open_days = _open_days(biz)
    z = service_level_z(_SERVICE_LEVEL)
    assume_on_time = bool((biz.settings or {}).get("assume_orders_arrive_on_time", False))
    ids_and_dates = [(r.id, r.date) for r in clean_records]

    # Booking-aware demand (spec: appointment businesses) — per-service booked
    # counts, sibling to the whole-business ones used in /forecast. Only
    # relevant for service-type products; loaded once, grouped by product.
    svc_booked_by_product: dict[int, dict[date, int]] = {}
    if (biz.settings or {}).get("appointment_based"):
        for r in db.query(ServiceBookedCount).filter_by(business_id=biz.id).all():
            svc_booked_by_product.setdefault(r.product_id, {})[r.date] = r.booked_count

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
            _is_fav = getattr(prod, "is_favorite", False) or False
            if prod_type == "service":
                result.append(ProductForecastItem(
                    product_id=prod.id, name=prod.name, unit=prod.unit,
                    product_type=prod_type, is_favorite=_is_fav,
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
                    product_type=prod_type, is_favorite=_is_fav,
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
        booked_by_date = svc_booked_by_product.get(prod.id, {}) if prod_type == "service" else {}
        holdout = _holdout_errors(demands, prod_wds, dates, n_per_weekday=4, booked_by_date=booked_by_date or None)

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
                    maes["seasonal_naive"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])
            except ValueError:
                pass

            p = _wma_for_weekday(demands, prod_wds, wd)
            if p is not None:
                errs = holdout["wma"].get(wd, [])
                if errs:
                    preds["wma"] = p
                    maes["wma"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])

            p = _exp_for_weekday(demands, prod_wds, wd)
            if p is not None:
                errs = holdout["exp_smoothing"].get(wd, [])
                if errs:
                    preds["exp_smoothing"] = p
                    maes["exp_smoothing"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])

            p = _linear_trend_for_weekday(demands, prod_wds, wd)
            if p is not None:
                errs = holdout["linear_trend"].get(wd, [])
                if errs:
                    same_wd = [v for v, w in zip(demands, prod_wds) if w == wd]
                    preds["linear_trend"] = _cap_linear_trend(p, same_wd)
                    maes["linear_trend"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])

            p = year_over_year_forecast(dates, demands, target)
            if p is not None:
                errs = holdout["year_over_year"].get(wd, [])
                if errs:
                    preds["year_over_year"] = p
                    maes["year_over_year"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])

            if booked_by_date:
                p = _booking_forecast_for_date(dates, demands, booked_by_date, target)
                if p is not None:
                    errs = holdout["booking"].get(wd, [])
                    if errs:
                        preds["booking"] = p
                        maes["booking"] = mad([abs(e) for e in errs[-_WEIGHT_WINDOW:]])

            if not preds:
                continue

            weights = model_weights(list(maes.values()))
            fval = max(0.0, blend(list(preds.values()), weights))

            all_wd_errs: list[float] = []
            for model_name in preds:
                all_wd_errs.extend(holdout[model_name].get(wd, [])[-_WEIGHT_WINDOW:])

            lo, hi = prediction_interval(fval, all_wd_errs) if len(all_wd_errs) >= 2 else (fval, fval)

            unit_mode_f = getattr(prod, "unit_mode", "whole") or "whole"
            forecast_days.append(ProductForecastDay(
                date=target,
                weekday=target.strftime("%A"),
                predicted_units=_round_qty(fval, unit_mode_f),
                interval_low=_round_qty(max(0.0, lo), unit_mode_f),
                interval_high=_round_qty(max(0.0, hi), unit_mode_f),
                booked_count=booked_by_date.get(target),
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
                is_favorite=getattr(prod, "is_favorite", False) or False,
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

        # ── projected stock (dynamic: baseline − sales + arrivals) ────────────
        proj_stock, stock_untracked = _compute_projected_stock(
            db, biz.id, prod, today, tap_by_prod_date, assume_on_time=assume_on_time
        )
        _eff_for_target = proj_stock if proj_stock is not None else prod.current_stock
        # Same order-up-to policy as /ordering, using the forecast-driven trigger.
        target_level, base_qty = order_up_to_target(
            avg_forecast, prod.lead_time_days, rop,
            _eff_for_target if _eff_for_target is not None else 0.0,
            storage_capacity=prod.storage_capacity,
        )
        effective_stock = proj_stock if proj_stock is not None else prod.current_stock

        constrained_qty, cap_notes, cap_codes = apply_order_constraints(
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
        if order_now and suggested_qty <= 0:
            order_now = False   # see /ordering: never "order now" for zero units
        if reorder_point_exceeds_capacity(rop, prod.storage_capacity):
            cap_notes.append(
                f"Your storage holds {_round_qty(prod.storage_capacity, unit_mode):g} "
                f"{prod.unit}, but covering a {prod.lead_time_days}-day delivery needs about "
                f"{_round_qty(rop, unit_mode):g}. Order smaller amounts more often, "
                f"or make more room."
            )
            cap_codes.append({"code": "storage_below_reorder_point", "params": {
                "capacity": _round_qty(prod.storage_capacity, unit_mode),
                "unit": prod.unit,
                "days": prod.lead_time_days,
                "needed": _round_qty(rop, unit_mode),
            }})
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
            is_favorite=getattr(prod, "is_favorite", False) or False,
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
            constraint_codes=cap_codes,
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
        svc_by_hour = service_minutes_per_customer(ev_subset, svc_by_pid, avg_svc, open_hours)
        slots: list[WeekdayHourlySlot] = []
        for hour, avg_taps_raw, _ in avgs:
            avg_taps_int = int(round(avg_taps_raw))  # customers are whole people
            eff_svc = svc_by_hour.get(hour, avg_svc)
            staff = _recommended_staff(avg_taps_raw, eff_svc, settings)
            _wa, _wr = marginal_waits(avg_taps_raw, eff_svc, staff)
            slots.append(WeekdayHourlySlot(
                hour=hour,
                avg_taps=avg_taps_int,
                recommended_staff=staff,
                label=_fmt_hour_range(hour),
                expected_wait_minutes=round(expected_wait_minutes(avg_taps_raw, eff_svc, staff), 1),
                marginal_note=marginal_note(avg_taps_raw, eff_svc, staff),
                wait_if_add=round(_wa, 1) if _wa is not None else None,
                wait_if_remove=round(_wr, 1) if _wr is not None else None,
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
    today = clock.today_local(biz.settings)

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

    # ── Day-of-week context (demoted — no longer a headline card) ────────────
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
            max_avg, min_avg = wd_avgs[max_wd], wd_avgs[min_wd]
            busiest_day_out = InsightsDayPattern(
                weekday=_WD_NAMES[max_wd],
                avg_customers=round(max_avg, 1),
                pct_vs_mean=round((max_avg - overall_mean) / overall_mean * 100, 1) if overall_mean > 0 else 0.0,
            )
            slowest_day_out = InsightsDayPattern(
                weekday=_WD_NAMES[min_wd],
                avg_customers=round(min_avg, 1),
                pct_vs_mean=round((min_avg - overall_mean) / overall_mean * 100, 1) if overall_mean > 0 else 0.0,
            )
            if min_avg > 0:
                pct_diff = round((max_avg - min_avg) / min_avg * 100, 1)

    # ── Hourly context (demoted — no longer a headline card) ─────────────────
    peak_hour_out: InsightsHourPattern | None = None
    quietest_hour_out: InsightsHourPattern | None = None

    settings = biz.settings or {}
    # One shared hourly profile — the same one the busy-hours chart draws — so
    # the two screens can never name different peak hours.
    avgs = _peak_hours(db, biz)
    if avgs and max(n for _h, _a, n in avgs) >= MIN_HOURLY_DAYS:
        peak, quiet = _peak_and_quiet_hour(avgs)
        if peak is not None:
            peak_hour_out = InsightsHourPattern(
                hour=peak[0], label=_fmt_hour_range(peak[0]), avg_taps=round(peak[1], 1),
            )
        if quiet is not None:
            quietest_hour_out = InsightsHourPattern(
                hour=quiet[0], label=_fmt_hour_range(quiet[0]), avg_taps=round(quiet[1], 1),
            )

    # ── Year-over-year (kept for context, not a headline) ────────────────────
    yoy_growth_pct: float | None = None
    yoy_prev_label: str | None = None
    yoy_curr_label: str | None = None

    data_span_days = (last_date - first_date).days
    obs_c = _effective_obs(clean_records)
    month_data: dict[tuple[int, int], list[float]] = {}
    for r, v in zip(clean_records, obs_c):
        month_data.setdefault((r.date.year, r.date.month), []).append(v)

    if data_span_days >= 365 and n_clean >= 28:
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

    # Same source of truth as the Accuracy screen — see _scored_forecasts.
    # `limit=None` because Insights is telling a longer story ("started at ~18%,
    # now ~8%") than the Accuracy screen's recent-90-day snapshot.
    matched: list[tuple[float, float]] = [
        (pred, actual) for _d, actual, pred in _scored_forecasts(db, biz, clean_records, limit=None)
    ]

    if len(matched) >= 4:
        try:
            forecast_accuracy_mape = round(mape([x[1] for x in matched], [x[0] for x in matched]), 1)
        except ValueError:
            pass

    if len(matched) >= 14:
        half = len(matched) // 2
        early, recent_m = matched[:half], matched[-half:]
        try:
            em = mape([x[1] for x in early], [x[0] for x in early])
            rm = mape([x[1] for x in recent_m], [x[0] for x in recent_m])
            accuracy_early_mape = round(em, 1)
            accuracy_recent_mape = round(rm, 1)
            accuracy_improved = rm < em
        except ValueError:
            pass

    if forecast_accuracy_mape is None and n_clean >= MIN_RECORDS:
        acc_records = [r for r in clean_records if r.outlier_status != "flagged"]
        if len(acc_records) >= MIN_RECORDS:
            holdout_obs = _effective_obs(acc_records)
            holdout_wds = [r.date.weekday() for r in acc_records]
            forecast_accuracy_mape = _compute_holdout_mape(holdout_obs, holdout_wds)

    # ── Weekday trends: last 12 weeks vs prior 12 weeks ───────────────────────
    weekday_trends_out: list[InsightsWeekdayTrend] = []
    recent_start = today - timedelta(weeks=12)
    prior_start  = today - timedelta(weeks=24)

    by_wd_recent: dict[int, list[float]] = {i: [] for i in range(7)}
    by_wd_prior:  dict[int, list[float]] = {i: [] for i in range(7)}
    for r in clean_records:
        if r.date >= recent_start:
            by_wd_recent[r.date.weekday()].append(float(r.customers))
        elif r.date >= prior_start:
            by_wd_prior[r.date.weekday()].append(float(r.customers))

    _MIN_WD_TREND_PTS = 4
    _MIN_PCT_CHANGE   = 10.0
    trend_candidates: list[InsightsWeekdayTrend] = []
    for wd in range(7):
        rec = by_wd_recent[wd]
        pri = by_wd_prior[wd]
        if len(rec) < _MIN_WD_TREND_PTS or len(pri) < _MIN_WD_TREND_PTS:
            continue
        rec_avg = mean(rec)
        pri_avg = mean(pri)
        if pri_avg == 0:
            continue
        pct = (rec_avg - pri_avg) / pri_avg * 100
        if abs(pct) < _MIN_PCT_CHANGE:
            continue
        trend_candidates.append(InsightsWeekdayTrend(
            weekday=_WD_NAMES[wd],
            pct_change=round(pct, 1),
            direction="growing" if pct > 0 else "declining",
            recent_avg=round(rec_avg, 1),
            prior_avg=round(pri_avg, 1),
        ))

    trend_candidates.sort(key=lambda x: abs(x.pct_change), reverse=True)
    weekday_trends_out = trend_candidates[:2]

    # ── Seasonal alerts: upcoming months vs same month last year ─────────────
    seasonal_alerts_out: list[InsightsSeasonalAlert] = []

    recent_4wk = [r for r in clean_records if r.date >= today - timedelta(weeks=4)]
    current_pace = mean([float(r.customers) for r in recent_4wk]) if recent_4wk else (
        mean([float(r.customers) for r in clean_records]) if clean_records else 0.0
    )

    _MIN_SEASONAL_PCT  = 12.0
    _MIN_MONTH_DAYS    = 10

    for months_ahead in range(1, 7):
        raw_mo  = today.month - 1 + months_ahead
        fut_mo  = raw_mo % 12 + 1
        fut_yr  = today.year + raw_mo // 12
        # Use most recent prior-year data for that month
        for yr_back in (1, 2):
            ly_key = (fut_yr - yr_back, fut_mo)
            ly_vals = month_data.get(ly_key, [])
            if len(ly_vals) >= _MIN_MONTH_DAYS:
                break
        else:
            continue

        if current_pace == 0:
            continue
        ly_avg = mean(ly_vals)

        # Compare that month against the level the business was running at AROUND
        # THAT TIME, not against today's pace.  Comparing to today confuses growth
        # with seasonality: a business that has simply got busier shows every
        # future month as "typically slower", which is exactly what happened —
        # three consecutive months were announced as slower purely because the
        # shop had grown about 23% over the year.  A ±5-month window either side
        # of the same month gives the local level and cancels the trend out.
        mid = date(fut_yr - yr_back, fut_mo, 15)
        around = [
            v for r, v in zip(clean_records, obs_c)
            if abs((r.date - mid).days) <= 150
        ]
        if len(around) < 60:
            continue                       # not enough surrounding history to judge
        ly_baseline = mean(around)
        if ly_baseline <= 0:
            continue

        seasonal_index = ly_avg / ly_baseline          # 1.0 = an ordinary month
        pct_diff_s = (seasonal_index - 1.0) * 100
        if abs(pct_diff_s) < _MIN_SEASONAL_PCT:
            continue

        first_of_month = date(fut_yr, fut_mo, 1)
        weeks_away = max(0, (first_of_month - today).days // 7)
        seasonal_alerts_out.append(InsightsSeasonalAlert(
            month_name=f"{_MONTH_NAMES[fut_mo - 1]} {fut_yr}",
            last_year_avg=round(ly_avg, 1),
            current_pace=round(current_pace, 1),
            pct_difference=round(abs(pct_diff_s), 1),
            direction="busier" if pct_diff_s > 0 else "quieter",
            weeks_away=weeks_away,
            expected_pace=round(current_pace * seasonal_index),
        ))

    seasonal_alerts_out.sort(key=lambda x: x.weeks_away)
    seasonal_alerts_out = seasonal_alerts_out[:3]

    # ── Declining regulars ────────────────────────────────────────────────────
    declining_regulars_out: list[InsightsDecliningRegular] = []
    _MIN_REGULAR_SPENDS = 3

    regulars_list = db.query(Regular).filter_by(business_id=biz.id).all()
    for reg in regulars_list:
        spends = (
            db.query(RegularDailySpend)
            .filter_by(regular_id=reg.id)
            .order_by(RegularDailySpend.date)
            .all()
        )
        if len(spends) < _MIN_REGULAR_SPENDS:
            continue
        visit_dates = [s.date for s in spends]
        last_visit  = visit_dates[-1]
        days_since  = (today - last_visit).days
        if len(visit_dates) >= 2:
            gaps    = [(visit_dates[i + 1] - visit_dates[i]).days for i in range(len(visit_dates) - 1)]
            avg_gap = mean(gaps)
        else:
            avg_gap = 7.0
        if avg_gap > 0 and days_since > max(7, 2.5 * avg_gap):
            declining_regulars_out.append(InsightsDecliningRegular(
                name=reg.name,
                days_since_visit=days_since,
                usual_gap_days=round(avg_gap, 1),
            ))

    declining_regulars_out.sort(key=lambda x: x.days_since_visit, reverse=True)
    declining_regulars_out = declining_regulars_out[:5]

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
        weekday_trends=weekday_trends_out,
        seasonal_alerts=seasonal_alerts_out,
        declining_regulars=declining_regulars_out,
    )

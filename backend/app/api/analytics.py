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

from app.api.deps import get_business
from app.db import get_db
from app.engine.accuracy import detect_drift, forecast_errors, mad, mape, mse, tracking_signal
from app.engine.limits import history_cutoff
from app.engine.monthly import monthly_summary
from app.engine.ensemble import blend, model_weights, prediction_interval
from app.engine.forecasting import (
    exponential_smoothing,
    linear_trend,
    same_date_last_year,
    weighted_moving_average,
)
from app.engine.live_sales import hourly_averages, hourly_product_mix
from app.engine.ordering import (
    apply_order_constraints,
    economic_order_quantity,
    projected_stock_timeline,
    reorder_point,
    safety_stock,
    service_level_z,
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
from app.models.order_record import OrderRecord
from app.schemas.analytics import (
    AccuracyResponse,
    ForecastDay,
    ForecastHistoryPoint,
    ForecastHistoryResponse,
    ForecastResponse,
    HistoryPoint,
    HourlyAnalyticsResponse,
    HourlySlotAvg,
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
_SERVICE_LEVEL = 0.95

MIN_RECORDS = 14  # ~2 weeks before forecasts are attempted


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

    Models: seasonal_naive, wma, exp_smoothing, linear_trend, same_date_last_year.
    same_date_last_year requires dates to be provided; it produces no errors when
    the data doesn't span a full year.
    """
    result: dict[str, dict[int, list[float]]] = {
        "seasonal_naive": {},
        "wma": {},
        "exp_smoothing": {},
        "linear_trend": {},
        "same_date_last_year": {},
    }

    by_wd: dict[int, list[int]] = {}
    for i, wd in enumerate(wds):
        by_wd.setdefault(wd, []).append(i)

    for wd, all_idx in by_wd.items():
        sn: list[float] = []
        wma_e: list[float] = []
        exp_e: list[float] = []
        lt_e: list[float] = []
        sdly_e: list[float] = []

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
                p = same_date_last_year(t_dates, t_obs, dates[hi])
                if p is not None:
                    sdly_e.append(actual - p)

        result["seasonal_naive"][wd] = sn
        result["wma"][wd] = wma_e
        result["exp_smoothing"][wd] = exp_e
        result["linear_trend"][wd] = lt_e
        result["same_date_last_year"][wd] = sdly_e

    return result


# ── /outliers ─────────────────────────────────────────────────────────────────

@router.get("/outliers", response_model=OutlierListResponse)
def get_outliers(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    """Detect and return unreviewed outlier days.

    Detection uses only the clean baseline: event/ad period dates and closed
    weekdays are excluded from the reference set so their legitimate
    spikes/zeros never contaminate the normal-day pattern or produce false
    flags.  Records flagged while inside an event period are auto-resolved.
    """
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

    # Clean detection set: exclude event periods, closed days, already-resolved records
    det_records = [
        r for r in all_records
        if r.date not in blocked
        and (open_days is None or r.date.weekday() in open_days)
        and r.outlier_status not in ("excluded", "event", "kept")
    ]

    if len(det_records) >= MIN_RECORDS:
        det_obs = [float(r.customers) for r in det_records]
        det_wds = [r.date.weekday() for r in det_records]
        det_results = detect_outliers(det_obs, det_wds)
        detected_by_id = {det_records[d.day_index].id: d for d in det_results}
    else:
        detected_by_id = {}

    changed = False

    # Auto-resolve: records now inside an event period should not remain flagged
    for r in all_records:
        if r.outlier_status == "flagged" and r.date in blocked:
            r.outlier_status = None  # restored to unreviewed; period now explains it
            changed = True

    # Auto-resolve records on recurring-pattern weekdays
    for r in all_records:
        if r.outlier_status == "flagged" and r.date.weekday() in recurring_weekdays:
            r.outlier_status = "kept"
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

        p = same_date_last_year(dates, obs, target_date)
        if p is not None:
            errs = holdout["same_date_last_year"].get(wd, [])
            if errs:
                preds["same_date_last_year"] = p
                maes["same_date_last_year"] = mad([abs(e) for e in errs])

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

        db.add(ForecastRun(
            business_id=biz.id,
            created_at=datetime.utcnow(),
            target_date=target_date,
            predicted_value=round(forecast_val, 2),
            interval_low=round(lo, 2),
            interval_high=round(hi, 2),
            model_weights=weights_out,
        ))

        days.append(ForecastDay(
            date=target_date,
            weekday=target_date.strftime("%A"),
            predicted_customers=round(forecast_val, 1),
            interval_low=round(lo, 1),
            interval_high=round(hi, 1),
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

    n_eval = min(42, len(obs) - 7)
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
        train_obs = _effective_obs(train_records)
        train_wds = [r.date.weekday() for r in train_records]

        total_actual = 0.0
        total_baseline = 0.0
        for r in period_records:
            total_actual += r.customers
            try:
                total_baseline += seasonal_naive_forecast(
                    train_obs, train_wds, r.date.weekday()
                )
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
    result: list[OrderingRow] = []

    for prod in products_list:
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
            result.append(OrderingRow(
                product_id=prod.id,
                name=prod.name,
                unit=prod.unit,
                avg_daily_demand=0.0,
                lead_time_days=prod.lead_time_days,
                safety_stock_units=0.0,
                reorder_point=0.0,
                current_stock=prod.current_stock,
                order_now=False,
                eoq=None,
                suggested_order_qty=0.0,
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
        constrained_qty, cap_notes = apply_order_constraints(
            base_qty,
            storage_capacity=prod.storage_capacity,
            current_stock=prod.current_stock,
            shelf_life_days=prod.shelf_life_days,
            avg_daily_demand=avg_daily,
        )
        suggested_qty = _round_qty(constrained_qty, unit_mode)
        order_now = prod.current_stock is not None and prod.current_stock <= rop

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
            order_now=order_now,
            eoq=eoq_val,
            suggested_order_qty=suggested_qty,
            constraint_notes=cap_notes,
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
            predicted=fr.predicted_value,
            actual=float(actual.customers),
            interval_low=fr.interval_low,
            interval_high=fr.interval_high,
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
    # Only apply the open-hours filter when the owner has explicitly configured
    # their hours.  Defaulting to 0/24 would silently include all 24 hours
    # (even overnight) when no hours have been saved yet.
    _raw_oh = settings.get("opening_hour")
    _raw_ch = settings.get("closing_hour")
    if _raw_oh is not None and _raw_ch is not None:
        _oh = int(_raw_oh)
        _ch = int(_raw_ch)
        open_hours: set[int] | None = set(range(_oh, _ch)) if _ch > _oh else None
    else:
        open_hours = None  # hours not configured: no filter

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

    raw = [(e.timestamp.date(), e.timestamp.hour, e.product_id, e.quantity) for e in events]
    n_days = len({e.timestamp.date() for e in events})

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
    ids_and_dates = [(r.id, r.date) for r in clean_records]

    result: list[ProductForecastItem] = []

    for prod in products_list:
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
            result.append(ProductForecastItem(
                product_id=prod.id, name=prod.name, unit=prod.unit,
                status="not_enough_data", message=msg,
                lead_time_days=prod.lead_time_days,
                current_stock=prod.current_stock,
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

            p = same_date_last_year(dates, demands, target)
            if p is not None:
                errs = holdout["same_date_last_year"].get(wd, [])
                if errs:
                    preds["same_date_last_year"] = p
                    maes["same_date_last_year"] = mad([abs(e) for e in errs])

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

        # ── ordering advice (forecast-based) ─────────────────────────────────
        avg_daily = mean(demands)
        sigma_daily = stdev(demands) if n_data > 1 else 0.0
        sigma_lt = sigma_daily * math.sqrt(prod.lead_time_days)
        ss = safety_stock(z, sigma_lt)

        # Demand over lead time: use forecast mean if available, else historical mean
        avg_forecast = mean([d.predicted_units for d in forecast_days]) if forecast_days else avg_daily
        forecast_demand_lt = avg_forecast * prod.lead_time_days
        rop = forecast_demand_lt + ss

        eoq_val: float | None = None
        unit_mode = getattr(prod, "unit_mode", "whole") or "whole"
        base_qty = forecast_demand_lt + ss
        constrained_qty, cap_notes = apply_order_constraints(
            base_qty,
            storage_capacity=prod.storage_capacity,
            current_stock=prod.current_stock,
            shelf_life_days=prod.shelf_life_days,
            avg_daily_demand=avg_daily,
        )
        suggested_qty = _round_qty(constrained_qty, unit_mode)
        order_now = prod.current_stock is not None and prod.current_stock <= rop

        # ── projected stock runout warning ────────────────────────────────────
        runout_warning = False
        if prod.current_stock is not None and avg_daily > 0 and forecast_days:
            pending_orders = (
                db.query(OrderRecord)
                .filter_by(business_id=biz.id, product_id=prod.id, status="pending")
                .all()
            )
            # Build arrivals as (day_offset, quantity); day_offset = days from today
            arrivals: list[tuple[int, float]] = []
            for o in pending_orders:
                offset = (o.expected_arrival_date - today).days
                if offset >= 0:
                    arrivals.append((offset, o.quantity))
            # Use the forecast's daily units as the depletion rate
            depletion = [d.predicted_units for d in forecast_days]
            projected = projected_stock_timeline(prod.current_stock, depletion, arrivals)
            runout_warning = will_stock_run_out(projected)

        result.append(ProductForecastItem(
            product_id=prod.id,
            name=prod.name,
            unit=prod.unit,
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
    # Only apply the open-hours filter when the owner has explicitly configured
    # their hours.  Defaulting to 0/24 would silently include all 24 hours
    # (even overnight) when no hours have been saved yet.
    _raw_oh2 = settings.get("opening_hour")
    _raw_ch2 = settings.get("closing_hour")
    if _raw_oh2 is not None and _raw_ch2 is not None:
        _oh2 = int(_raw_oh2)
        _ch2 = int(_raw_ch2)
        open_hours: set[int] | None = set(range(_oh2, _ch2)) if _ch2 > _oh2 else None
    else:
        open_hours = None  # hours not configured: no filter

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

    raw = [(e.timestamp.date(), e.timestamp.hour, e.product_id, e.quantity) for e in events]
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

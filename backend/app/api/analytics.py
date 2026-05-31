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
from app.engine.accuracy import forecast_errors, mad, mape, mse, tracking_signal
from app.engine.limits import history_cutoff
from app.engine.monthly import monthly_summary
from app.engine.ensemble import blend, model_weights, prediction_interval
from app.engine.forecasting import exponential_smoothing, weighted_moving_average
from app.engine.live_sales import hourly_averages, hourly_product_mix
from app.engine.ordering import (
    economic_order_quantity,
    reorder_point,
    safety_stock,
    service_level_z,
)
from app.engine.outliers import detect_outliers
from app.engine.product_forecast import build_product_demand_series
from app.engine.queueing import (
    effective_service_time,
    expected_wait_minutes,
    marginal_note,
    min_servers,
    queue_length,
)
from app.engine.seasonality import seasonal_naive_forecast
from app.models import Business, DayRecord, ForecastRun, Period, Product, SaleEvent, SaleRecord
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
)

router = APIRouter(tags=["Analytics"])

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


def _holdout_errors(
    obs: list[float], wds: list[int], n_per_weekday: int = 4
) -> dict[str, dict[int, list[float]]]:
    """
    Leave-one-out signed errors (actual − predicted) for each model and weekday.

    For each weekday, the last n_per_weekday occurrences are treated as a holdout.
    Each point is predicted using only data that came before it in time.
    Returns {"seasonal_naive": {weekday: [errors]}, "wma": {...}, "exp_smoothing": {...}}
    """
    result: dict[str, dict[int, list[float]]] = {
        "seasonal_naive": {}, "wma": {}, "exp_smoothing": {}
    }

    by_wd: dict[int, list[int]] = {}
    for i, wd in enumerate(wds):
        by_wd.setdefault(wd, []).append(i)

    for wd, all_idx in by_wd.items():
        sn: list[float] = []
        wma: list[float] = []
        exp: list[float] = []

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
                wma.append(actual - p)

            p = _exp_for_weekday(t_obs, t_wds, wd)
            if p is not None:
                exp.append(actual - p)

        result["seasonal_naive"][wd] = sn
        result["wma"][wd] = wma
        result["exp_smoothing"][wd] = exp

    return result


# ── /outliers ─────────────────────────────────────────────────────────────────

@router.get("/outliers", response_model=OutlierListResponse)
def get_outliers(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    """Detect and return unreviewed outlier days.

    On each call, detection runs on all records with no existing status
    (outlier_status IS NULL). Newly found outliers are persisted as 'flagged'.
    Already-resolved records are never re-flagged.
    Returns all currently-flagged records with a plain-language message.
    """
    all_records = (
        db.query(DayRecord)
        .filter_by(business_id=biz.id)
        .order_by(DayRecord.date)
        .all()
    )

    if len(all_records) < MIN_RECORDS:
        return OutlierListResponse(status="ok", flags=[])

    obs = [float(r.customers) for r in all_records]
    wds = [r.date.weekday() for r in all_records]

    detected = {d.day_index: d for d in detect_outliers(obs, wds)}

    # Flag unreviewed records that are now detected as outliers
    changed = False
    for i, r in enumerate(all_records):
        if r.outlier_status is None and i in detected:
            r.outlier_status = "flagged"
            changed = True
    if changed:
        db.commit()

    # Build response for all currently-flagged records
    flags: list[OutlierFlag] = []
    for i, r in enumerate(all_records):
        if r.outlier_status != "flagged":
            continue

        det = detected.get(i)
        wd_name = _WD_NAMES[r.date.weekday()]

        if det:
            median_val = det.weekday_median
            direction = det.direction
        else:
            # Still flagged but no longer detected (more data arrived); best effort
            same = [obs[j] for j in range(len(obs)) if wds[j] == r.date.weekday() and j != i]
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

    holdout = _holdout_errors(obs, wds, n_per_weekday=4)

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
            preds["seasonal_naive"] = seasonal_naive_forecast(obs, wds, wd)
            errs = holdout["seasonal_naive"].get(wd, [])
            maes["seasonal_naive"] = mad([abs(e) for e in errs]) if errs else 1.0
        except ValueError:
            pass

        p = _wma_for_weekday(obs, wds, wd)
        if p is not None:
            preds["wma"] = p
            errs = holdout["wma"].get(wd, [])
            maes["wma"] = mad([abs(e) for e in errs]) if errs else 1.0

        p = _exp_for_weekday(obs, wds, wd)
        if p is not None:
            preds["exp_smoothing"] = p
            errs = holdout["exp_smoothing"].get(wd, [])
            maes["exp_smoothing"] = mad([abs(e) for e in errs]) if errs else 1.0

        if not preds:
            continue

        weights = model_weights(list(maes.values()))
        forecast_val = blend(list(preds.values()), weights)

        all_wd_errs: list[float] = []
        for m_errs in holdout.values():
            all_wd_errs.extend(m_errs.get(wd, []))

        if len(all_wd_errs) >= 2:
            lo, hi = prediction_interval(forecast_val, all_wd_errs)
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
    return ForecastResponse(status="ok", days=days)


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

    return AccuracyResponse(
        status="ok",
        n_observations=len(actuals),
        mad=round(mad(errors), 2),
        mse=round(mse(errors), 2),
        mape=mape_val,
        tracking_signal=round(ts, 3),
        bias_warning=bias_warning,
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

    # Exclude fluke/event days and closed weekdays from demand averages
    open_days = _open_days(biz)
    all_records = [
        r for r in db.query(DayRecord)
        .filter_by(business_id=biz.id)
        .order_by(DayRecord.date)
        .all()
        if r.outlier_status not in ("excluded", "event")
        and (open_days is None or r.date.weekday() in open_days)
    ]
    if len(all_records) < MIN_RECORDS:
        return OrderingResponse(
            status="not_enough_data",
            message=f"Need at least {MIN_RECORDS} days of data for ordering recommendations "
                    f"({len(all_records)} so far).",
            products=[],
        )

    n_days = len(all_records)
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
        sales_by_day = {s.day_record_id: s.units_sold for s in sales}
        daily_demand = [float(sales_by_day.get(r.id, 0.0)) for r in all_records]

        avg_daily = mean(daily_demand)
        sigma_daily = stdev(daily_demand) if n_days > 1 else 0.0
        sigma_lt = sigma_daily * math.sqrt(prod.lead_time_days)

        ss = safety_stock(z, sigma_lt)
        rop = reorder_point(avg_daily, prod.lead_time_days, z, sigma_lt)

        eoq_val = None
        if prod.order_cost and prod.holding_cost and avg_daily > 0:
            try:
                eoq_val = round(economic_order_quantity(avg_daily * 365, prod.order_cost, prod.holding_cost), 1)
            except ValueError:
                pass

        order_now = prod.current_stock is not None and prod.current_stock <= rop

        result.append(OrderingRow(
            product_id=prod.id,
            name=prod.name,
            unit=prod.unit,
            avg_daily_demand=round(avg_daily, 2),
            lead_time_days=prod.lead_time_days,
            safety_stock_units=round(ss, 1),
            reorder_point=round(rop, 1),
            current_stock=prod.current_stock,
            order_now=order_now,
            eoq=eoq_val,
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
    opening_hour = int(settings.get("opening_hour", 0))
    closing_hour = int(settings.get("closing_hour", 24))
    open_hours = set(range(opening_hour, closing_hour)) if closing_hour > opening_hour else None

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
    for hour, avg_taps, n in avgs:
        hour_mix = mix_by_hour.get(hour, {})
        # (quantity, service_time_or_None) — None product_id or no override → falls back to default
        product_mix_pairs = [(qty, svc_by_pid.get(pid)) for pid, qty in hour_mix.items()]
        eff_svc = effective_service_time(product_mix_pairs, avg_svc) if product_mix_pairs else avg_svc
        staff = min_servers(avg_taps, eff_svc)
        time_range = _fmt_hour_range(hour)
        word = "person" if staff == 1 else "people"
        hours.append(HourlySlotAvg(
            hour=hour,
            avg_taps=avg_taps,
            n_days=n,
            recommended_staff=staff,
            label=f"For {time_range}, schedule {staff} {word}",
            expected_wait_minutes=round(expected_wait_minutes(avg_taps, eff_svc, staff), 1),
            queue_length=round(queue_length(avg_taps, eff_svc, staff), 2),
            marginal_note=marginal_note(avg_taps, eff_svc, staff),
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
        wds = [d.weekday() for d in dates]
        holdout = _holdout_errors(demands, wds, n_per_weekday=4)

        forecast_days: list[ProductForecastDay] = []
        for offset in range(1, 8):
            target = today + timedelta(days=offset)
            wd = target.weekday()
            if open_days is not None and wd not in open_days:
                continue

            preds: dict[str, float] = {}
            maes: dict[str, float] = {}

            try:
                preds["seasonal_naive"] = seasonal_naive_forecast(demands, wds, wd)
                errs = holdout["seasonal_naive"].get(wd, [])
                maes["seasonal_naive"] = mad([abs(e) for e in errs]) if errs else 1.0
            except ValueError:
                pass

            p = _wma_for_weekday(demands, wds, wd)
            if p is not None:
                preds["wma"] = p
                errs = holdout["wma"].get(wd, [])
                maes["wma"] = mad([abs(e) for e in errs]) if errs else 1.0

            p = _exp_for_weekday(demands, wds, wd)
            if p is not None:
                preds["exp_smoothing"] = p
                errs = holdout["exp_smoothing"].get(wd, [])
                maes["exp_smoothing"] = mad([abs(e) for e in errs]) if errs else 1.0

            if not preds:
                continue

            weights = model_weights(list(maes.values()))
            fval = max(0.0, blend(list(preds.values()), weights))

            all_wd_errs: list[float] = []
            for m_errs in holdout.values():
                all_wd_errs.extend(m_errs.get(wd, []))

            lo, hi = prediction_interval(fval, all_wd_errs) if len(all_wd_errs) >= 2 else (fval, fval)

            forecast_days.append(ProductForecastDay(
                date=target,
                weekday=target.strftime("%A"),
                predicted_units=round(fval, 2),
                interval_low=round(max(0.0, lo), 2),
                interval_high=round(max(0.0, hi), 2),
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
        if prod.order_cost and prod.holding_cost and avg_daily > 0:
            try:
                eoq_val = round(economic_order_quantity(avg_daily * 365, prod.order_cost, prod.holding_cost), 1)
            except ValueError:
                pass

        suggested_qty = eoq_val if eoq_val is not None else round(forecast_demand_lt + ss, 1)
        order_now = prod.current_stock is not None and prod.current_stock <= rop

        result.append(ProductForecastItem(
            product_id=prod.id,
            name=prod.name,
            unit=prod.unit,
            status="ok",
            days=forecast_days,
            avg_daily_demand=round(avg_daily, 2),
            forecast_demand_over_lead_time=round(forecast_demand_lt, 1),
            lead_time_days=prod.lead_time_days,
            safety_stock_units=round(ss, 1),
            reorder_point=round(rop, 1),
            suggested_order_qty=round(suggested_qty, 1),
            current_stock=prod.current_stock,
            order_now=order_now,
            eoq=eoq_val,
            n_days_data=n_data,
        ))

    return ProductForecastResponse(status="ok", products=result)

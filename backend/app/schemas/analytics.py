from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel


# ── outlier flags ─────────────────────────────────────────────────────────────

class OutlierFlag(BaseModel):
    day_record_id: int
    date: date
    weekday: str
    customers: int
    weekday_median: float
    direction: str   # 'high' or 'low'
    message: str     # plain-language prompt for the owner


class OutlierListResponse(BaseModel):
    status: str
    flags: list[OutlierFlag]


class ForecastDay(BaseModel):
    date: date
    weekday: str
    predicted_customers: float
    interval_low: float
    interval_high: float
    model_weights: dict[str, float]


class ForecastResponse(BaseModel):
    status: str
    message: Optional[str] = None
    days: list[ForecastDay]
    drift_alert: Optional[str] = None  # plain-language sustained-drift warning


class AccuracyResponse(BaseModel):
    status: str
    n_observations: int
    mad: Optional[float] = None
    mse: Optional[float] = None
    mape: Optional[float] = None
    tracking_signal: Optional[float] = None
    bias_warning: Optional[str] = None
    drift_alert: Optional[str] = None
    message: Optional[str] = None


class PeriodLift(BaseModel):
    period_id: int
    label: str
    type: str
    start_date: date
    end_date: date
    target_product_id: Optional[int] = None
    total_actual: float
    total_baseline: float
    total_lift_customers: float
    pct_lift: float
    lift_per_cost: Optional[float] = None


class LiftResponse(BaseModel):
    status: str
    message: Optional[str] = None
    periods: list[PeriodLift]


# ── weekday averages ──────────────────────────────────────────────────────────

class WeekdayAvg(BaseModel):
    weekday: str
    weekday_idx: int
    avg_customers: float
    std_dev: float
    n_observations: int


class WeekdayAvgResponse(BaseModel):
    status: str
    message: Optional[str] = None
    weekdays: list[WeekdayAvg]


# ── ordering ──────────────────────────────────────────────────────────────────

class OrderingRow(BaseModel):
    product_id: int
    name: str
    unit: str
    unit_mode: str = "whole"
    avg_daily_demand: float
    lead_time_days: int
    safety_stock_units: float
    reorder_point: float
    current_stock: Optional[float] = None
    projected_stock: Optional[float] = None   # dynamically computed; None when untracked
    stock_untracked: bool = False              # no baseline set; stock can't be projected
    approaching_reorder: bool = False          # heads-up before hitting the reorder point
    order_now: bool
    eoq: Optional[float] = None
    suggested_order_qty: float = 0.0
    constraint_notes: list[str] = []
    # Batch-FIFO fields
    fifo_note: Optional[str] = None           # always shown when batches exist: "assumes oldest first (FIFO)"
    older_stock_warning: Optional[str] = None # older batches expiring before new order arrives
    spoilage_alert: Optional[str] = None      # batches that have already expired with stock left


class OrderingResponse(BaseModel):
    status: str
    message: Optional[str] = None
    products: list[OrderingRow]


# ── forecast history ──────────────────────────────────────────────────────────

class ForecastHistoryPoint(BaseModel):
    date: date
    weekday: str
    predicted: float
    actual: float
    interval_low: float
    interval_high: float


class ForecastHistoryResponse(BaseModel):
    status: str
    message: Optional[str] = None
    history: list[ForecastHistoryPoint]


# ── hourly analytics & staffing ───────────────────────────────────────────────

class HourlySlotAvg(BaseModel):
    hour: int               # 0–23
    avg_taps: int           # whole-number average customers per day at this hour (customers are whole people)
    n_days: int             # days in the dataset used to compute the average
    recommended_staff: int  # min servers from M/M/c engine
    label: str              # plain-language: "For 9–10 am, schedule 2 people"
    expected_wait_minutes: float   # average queue wait at recommended staffing
    queue_length: float            # average customers waiting at recommended staffing
    marginal_note: str             # what adding/removing 1 worker does


class HourlyAnalyticsResponse(BaseModel):
    status: str
    message: Optional[str] = None
    n_days_data: int = 0
    avg_service_time_minutes: float = 5.0
    hours: list[HourlySlotAvg] = []


# ── monthly / longer-history view ─────────────────────────────────────────────

class HistoryPoint(BaseModel):
    date: date
    customers: float  # effective value (outlier-replaced where applicable)


class MonthSummary(BaseModel):
    year: int
    month: int
    month_label: str           # e.g. "Jan 2024"
    total_customers: float
    logged_days: int
    avg_daily_customers: float
    mom_pct_change: Optional[float]  # None for first month; + = up, - = down


class MonthlyResponse(BaseModel):
    status: str
    message: Optional[str] = None
    n_total_days: int = 0
    months: list[MonthSummary] = []
    history_points: list[HistoryPoint] = []  # all clean daily points for the history chart


# ── per-product demand forecast ───────────────────────────────────────────────

class ProductForecastDay(BaseModel):
    date: date
    weekday: str
    predicted_units: float
    interval_low: float
    interval_high: float


class ProductForecastItem(BaseModel):
    product_id: int
    name: str
    unit: str
    unit_mode: str = "whole"
    status: str                           # "ok" | "not_enough_data"
    message: Optional[str] = None
    days: list[ProductForecastDay] = []
    # ordering advice (populated when status == "ok")
    avg_daily_demand: float = 0.0
    forecast_demand_over_lead_time: float = 0.0
    lead_time_days: int = 1
    safety_stock_units: float = 0.0
    reorder_point: float = 0.0
    suggested_order_qty: float = 0.0      # EOQ if costs known, else ROP-based
    current_stock: Optional[float] = None
    projected_stock: Optional[float] = None   # dynamically computed; None when untracked
    stock_untracked: bool = False              # no baseline set; stock can't be projected
    approaching_reorder: bool = False          # heads-up before hitting the reorder point
    order_now: bool = False
    eoq: Optional[float] = None
    n_days_data: int = 0
    constraint_notes: list[str] = []
    # True when projected stock will hit zero before any pending order arrives
    projected_runout_warning: bool = False


class ProductForecastResponse(BaseModel):
    status: str
    message: Optional[str] = None
    products: list[ProductForecastItem]


# ── business insights ─────────────────────────────────────────────────────────

class InsightsDayPattern(BaseModel):
    weekday: str
    avg_customers: float
    pct_vs_mean: float  # positive = above mean, negative = below mean


class InsightsHourPattern(BaseModel):
    hour: int
    label: str        # formatted range e.g. "9–10 am"
    avg_taps: float


class InsightsResponse(BaseModel):
    status: str
    message: Optional[str] = None

    # Data volume
    n_days_logged: Optional[int] = None
    n_months_logged: Optional[int] = None
    first_date: Optional[date] = None
    last_date: Optional[date] = None

    # Day-of-week patterns (need ≥7 clean days, ≥2 weekdays with ≥2 points each)
    busiest_day: Optional[InsightsDayPattern] = None
    slowest_day: Optional[InsightsDayPattern] = None
    pct_diff_busiest_slowest: Optional[float] = None  # % busiest is above slowest

    # Hourly patterns (need ≥7 days of tap data)
    peak_hour: Optional[InsightsHourPattern] = None
    quietest_hour: Optional[InsightsHourPattern] = None

    # Year-over-year (need data spanning ≥365 days + a matching prior-year month)
    yoy_growth_pct: Optional[float] = None
    yoy_prev_period_label: Optional[str] = None
    yoy_curr_period_label: Optional[str] = None

    # Forecast accuracy
    forecast_accuracy_mape: Optional[float] = None  # overall MAPE from ForecastRun history
    accuracy_early_mape: Optional[float] = None     # first half of ForecastRun history
    accuracy_recent_mape: Optional[float] = None    # recent half of ForecastRun history
    accuracy_improved: Optional[bool] = None


# ── per-weekday hourly profiles ───────────────────────────────────────────────

class WeekdayHourlySlot(BaseModel):
    hour: int
    avg_taps: int              # whole-number average (customers are whole people; never show decimals)
    recommended_staff: int
    label: str                 # formatted range: "5–6 pm"
    expected_wait_minutes: float
    marginal_note: str = ""    # what adding/removing 1 worker does


class WeekdayHourlyEntry(BaseModel):
    weekday: str               # "Monday" … "Sunday"
    weekday_idx: int           # 0=Mon … 6=Sun
    peak_hour: int
    peak_avg_taps: float
    n_days_data: int
    hours: list[WeekdayHourlySlot]


class WeekdayHourlyResponse(BaseModel):
    status: str
    message: Optional[str] = None
    weekdays: list[WeekdayHourlyEntry] = []      # only weekdays with ≥ MIN_WEEKDAY_HOURLY days
    overall_fallback: list[WeekdayHourlySlot] = []  # all-days average as fallback
    n_days_total: int = 0

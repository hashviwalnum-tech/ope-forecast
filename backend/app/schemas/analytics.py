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
    order_now: bool
    eoq: Optional[float] = None
    suggested_order_qty: float = 0.0
    constraint_notes: list[str] = []


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
    avg_taps: float         # average taps/customers per day at this hour
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
    order_now: bool = False
    eoq: Optional[float] = None
    n_days_data: int = 0
    constraint_notes: list[str] = []


class ProductForecastResponse(BaseModel):
    status: str
    message: Optional[str] = None
    products: list[ProductForecastItem]


# ── per-weekday hourly profiles ───────────────────────────────────────────────

class WeekdayHourlySlot(BaseModel):
    hour: int
    avg_taps: float
    recommended_staff: int
    label: str                 # formatted range: "5–6 pm"
    expected_wait_minutes: float


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

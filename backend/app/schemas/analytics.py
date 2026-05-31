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
    avg_daily_demand: float
    lead_time_days: int
    safety_stock_units: float
    reorder_point: float
    current_stock: Optional[float] = None
    order_now: bool
    eoq: Optional[float] = None


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

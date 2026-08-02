from __future__ import annotations

from datetime import date as date_type, datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class SaleEventCreate(BaseModel):
    product_id: Optional[int] = None
    quantity: float = Field(1.0, ge=0.01)
    unit_price: Optional[float] = Field(None, ge=0)


class SaleEventRead(BaseModel):
    id: int
    business_id: int
    product_id: Optional[int]
    timestamp: datetime
    quantity: float
    unit_price: Optional[float]

    model_config = {"from_attributes": True}

    @field_validator("timestamp")
    @classmethod
    def _tag_utc(cls, ts: datetime) -> datetime:
        """Tag a naive datetime as UTC so it serializes with an explicit offset.

        SaleEvent.timestamp is stored naive-but-UTC (see live_sales.py).
        Without this, FastAPI serializes it as e.g. "2026-08-02T11:10:00"
        with no offset, which browsers parse as *local browser time* instead
        of UTC — silently shifting every displayed time by the viewer's
        UTC offset.
        """
        return ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)


# ── today-summary response ─────────────────────────────────────────────────

class ProductTap(BaseModel):
    product_id: Optional[int]
    product_name: Optional[str]
    units: float


class HourSlot(BaseModel):
    hour: int
    taps: int
    product_taps: list[ProductTap]


class RecentTap(BaseModel):
    id: int
    product_name: Optional[str]   # None means "customer, no product"
    quantity: float
    timestamp: datetime

    @field_validator("timestamp")
    @classmethod
    def _tag_utc(cls, ts: datetime) -> datetime:
        return ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)


class TodaySummaryResponse(BaseModel):
    date: date_type
    total_taps: int
    product_totals: list[ProductTap]   # running totals per product — feeds button badges
    hours: list[HourSlot]              # hourly breakdown for the end-of-day chart
    recent_taps: list[RecentTap]       # last 10 individual events, newest first
    timezone: str                      # IANA name used to bucket "today" and its hours (business tz, or "UTC")


# ── hourly backfill (past-day entry from register logs) ───────────────────────

class HourlySlot(BaseModel):
    hour: int = Field(..., ge=0, le=23)
    customers: float = Field(..., gt=0)


class HourlyBackfillRequest(BaseModel):
    date: date_type
    hours: list[HourlySlot] = Field(..., min_length=1)


class HourlyBackfillResponse(BaseModel):
    inserted: int

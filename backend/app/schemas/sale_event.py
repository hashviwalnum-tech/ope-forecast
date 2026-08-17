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


class ProductUnits(BaseModel):
    """Units of one product sold on the day being submitted."""
    product_id: int
    units: float = Field(..., ge=0)


class HourlyBackfillRequest(BaseModel):
    date: date_type
    hours: list[HourlySlot] = Field(..., min_length=1)
    # Per-product totals for the same day, when the submission actually has
    # them (a register export, or a CSV with product columns).  Left unset for
    # a customers-only submission — and that distinction matters: the endpoint
    # only ever replaces the kind of data it was actually given.  It used to
    # wipe every sale event for the day regardless, so an owner who tapped
    # products during service and later tidied up their hourly customer counts
    # silently lost the whole product breakdown for that day.
    products: Optional[list[ProductUnits]] = None


class HourlyBackfillResponse(BaseModel):
    inserted: int
    # What the submission actually did, so the client can tell the owner
    # plainly rather than leaving them to guess.
    replaced_hours: int = 0
    replaced_products: int = 0
    kept_products: int = 0


class BackfillPreviewProduct(BaseModel):
    product_id: int
    product_name: str
    units: float


class BackfillPreviewResponse(BaseModel):
    """What is already stored for a date, so the owner can be shown what a
    submission is about to replace and what it will leave alone."""
    date: date_type
    existing_hours: int              # hourly customer-count rows already stored
    existing_hour_customers: float   # their total
    existing_products: list[BackfillPreviewProduct]

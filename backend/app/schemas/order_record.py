from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field


class OrderRecordCreate(BaseModel):
    product_id: int
    ordered_date: date
    quantity: float = Field(..., gt=0)


class OrderRecordUpdate(BaseModel):
    quantity: Optional[float] = Field(None, gt=0)
    status: Optional[Literal["pending", "arrived", "cancelled"]] = None


class OrderRecordRead(BaseModel):
    id: int
    business_id: int
    product_id: int
    ordered_date: date
    quantity: float
    expected_arrival_date: date
    status: str
    # What the order's status effectively IS, given the business's
    # "always assume orders arrive on time" setting.  The stock projection has
    # always honoured that setting, but the stored status never changed — so an
    # owner with it switched on saw a year of long-since-delivered orders still
    # listed as "in transit", one row each, on their home screen.
    effective_status: Optional[str] = None

    model_config = {"from_attributes": True}

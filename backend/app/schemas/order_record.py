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

    model_config = {"from_attributes": True}

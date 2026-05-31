from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SaleCreate(BaseModel):
    day_record_id: int
    product_id: int
    units_sold: float = Field(..., ge=0)


class SaleUpdate(BaseModel):
    units_sold: Optional[float] = Field(None, ge=0)


class SaleRead(BaseModel):
    id: int
    day_record_id: int
    product_id: int
    units_sold: float

    model_config = {"from_attributes": True}

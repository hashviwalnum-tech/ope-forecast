from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class ProductCreate(BaseModel):
    name: str
    unit: str
    current_stock: Optional[float] = Field(None, ge=0)
    lead_time_days: int = Field(..., ge=1)
    holding_cost: Optional[float] = Field(None, ge=0)
    order_cost: Optional[float] = Field(None, ge=0)


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    current_stock: Optional[float] = Field(None, ge=0)
    lead_time_days: Optional[int] = Field(None, ge=1)
    holding_cost: Optional[float] = Field(None, ge=0)
    order_cost: Optional[float] = Field(None, ge=0)


class ProductRead(BaseModel):
    id: int
    business_id: int
    name: str
    unit: str
    current_stock: Optional[float]
    lead_time_days: int
    holding_cost: Optional[float]
    order_cost: Optional[float]

    model_config = {"from_attributes": True}

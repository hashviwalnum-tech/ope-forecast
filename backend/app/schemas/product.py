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
    service_time_minutes: Optional[float] = Field(None, gt=0)
    storage_capacity: Optional[float] = Field(None, gt=0)
    shelf_life_days: Optional[int] = Field(None, ge=1)


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    current_stock: Optional[float] = Field(None, ge=0)
    lead_time_days: Optional[int] = Field(None, ge=1)
    holding_cost: Optional[float] = Field(None, ge=0)
    order_cost: Optional[float] = Field(None, ge=0)
    service_time_minutes: Optional[float] = Field(None, gt=0)
    storage_capacity: Optional[float] = Field(None, gt=0)
    shelf_life_days: Optional[int] = Field(None, ge=1)


class ProductRead(BaseModel):
    id: int
    business_id: int
    name: str
    unit: str
    current_stock: Optional[float]
    lead_time_days: int
    holding_cost: Optional[float]
    order_cost: Optional[float]
    service_time_minutes: Optional[float]
    storage_capacity: Optional[float]
    shelf_life_days: Optional[int]

    model_config = {"from_attributes": True}

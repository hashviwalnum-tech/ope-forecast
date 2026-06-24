from __future__ import annotations

from pydantic import BaseModel, Field


class ServiceConsumableCreate(BaseModel):
    consumable_product_id: int
    qty_per_performance: float = Field(..., gt=0)


class ServiceConsumableRead(BaseModel):
    id: int
    service_product_id: int
    consumable_product_id: int
    qty_per_performance: float
    consumable_name: str = ""   # populated by the API handler
    consumable_unit: str = ""

    model_config = {"from_attributes": True}

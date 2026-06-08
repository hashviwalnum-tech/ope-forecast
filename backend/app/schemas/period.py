from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class PeriodCreate(BaseModel):
    start_date: date
    end_date: date
    type: Literal["event", "ad"]
    label: str
    cost: Optional[float] = Field(None, ge=0)
    target_product_id: Optional[int] = None

    @model_validator(mode="after")
    def end_not_before_start(self) -> "PeriodCreate":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be >= start_date")
        return self


class PeriodUpdate(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    type: Optional[Literal["event", "ad"]] = None
    label: Optional[str] = None
    cost: Optional[float] = Field(None, ge=0)
    target_product_id: Optional[int] = None


class PeriodRead(BaseModel):
    id: int
    business_id: int
    start_date: date
    end_date: date
    type: str
    label: str
    cost: Optional[float]
    target_product_id: Optional[int] = None

    model_config = {"from_attributes": True}

from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class RegularCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    visit_frequency_per_week: float = Field(..., gt=0)
    avg_spend: float = Field(..., ge=0)
    expected_lifespan_years: float = Field(3.0, gt=0)
    notes: Optional[str] = Field(None, max_length=1000)


class RegularUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    visit_frequency_per_week: Optional[float] = Field(None, gt=0)
    avg_spend: Optional[float] = Field(None, ge=0)
    expected_lifespan_years: Optional[float] = Field(None, gt=0)
    notes: Optional[str] = Field(None, max_length=1000)


class RegularRead(BaseModel):
    id: int
    business_id: int
    name: str
    visit_frequency_per_week: float
    avg_spend: float
    expected_lifespan_years: float
    notes: Optional[str]
    visit_count: int
    first_visit_date: Optional[date]
    last_visit_date: Optional[date]
    clv: float  # computed: frequency_per_week × 52 × avg_spend × lifespan_years

    model_config = {"from_attributes": True}

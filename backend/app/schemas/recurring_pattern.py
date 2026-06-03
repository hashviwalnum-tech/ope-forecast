from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class RecurringPatternCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=200)
    weekdays: List[int] = Field(..., description="Weekdays covered: 0=Mon … 6=Sun")
    hour_start: Optional[int] = Field(None, ge=0, le=23)
    hour_end: Optional[int] = Field(None, ge=0, le=23)
    effect: Literal["higher", "lower", "expected"] = "higher"


class RecurringPatternUpdate(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=200)
    weekdays: Optional[List[int]] = None
    hour_start: Optional[int] = Field(None, ge=0, le=23)
    hour_end: Optional[int] = Field(None, ge=0, le=23)
    effect: Optional[Literal["higher", "lower", "expected"]] = None


class RecurringPatternRead(BaseModel):
    id: int
    business_id: int
    label: str
    weekdays: List[int]
    hour_start: Optional[int]
    hour_end: Optional[int]
    effect: str

    model_config = {"from_attributes": True}

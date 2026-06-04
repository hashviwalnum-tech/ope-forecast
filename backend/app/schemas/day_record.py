from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field


class DayRecordCreate(BaseModel):
    date: date
    customers: int = Field(..., ge=0)
    notes: Optional[str] = None


class DayRecordUpdate(BaseModel):
    customers: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = None


class DayRecordRead(BaseModel):
    id: int
    business_id: int
    date: date
    customers: int
    notes: Optional[str]
    outlier_status: Optional[str] = None

    model_config = {"from_attributes": True}


class OutlierResolveRequest(BaseModel):
    action: Literal["keep", "excluded", "event", "ad", "recurring", "unflag"]

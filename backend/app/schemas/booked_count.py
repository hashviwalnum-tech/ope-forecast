from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class BookedCountUpsert(BaseModel):
    booked_count: int = Field(ge=0)


class BookedCountRead(BaseModel):
    date: date
    booked_count: int

    model_config = {"from_attributes": True}

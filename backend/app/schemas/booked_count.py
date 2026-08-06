from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class BookedCountUpsert(BaseModel):
    booked_count: int = Field(ge=0)


class BookedCountRead(BaseModel):
    date: date
    booked_count: int
    product_id: int | None = None  # None = whole-business total; set = a specific service

    model_config = {"from_attributes": True}

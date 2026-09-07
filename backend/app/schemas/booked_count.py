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


class BookingModelRead(BaseModel):
    """What Ope has worked out about this business's bookings.

    `status` is 'learning' until there are enough (booked, actual) pairs to fit
    — the show-up and walk-in figures are None until then. A confident-sounding
    percentage produced from three days would be worse than saying nothing, so
    the app says nothing, the same way the early forecast does.
    """
    status: str                                  # 'off' | 'learning' | 'ok'
    pairs: int                                   # (booked, actual) days the fit could use
    pairs_needed: int                            # how many it needs before it will fit
    no_show_rate: float | None = None            # 0.14 = about 1 in 7 booked don't show
    walk_ins_per_day: float | None = None        # unbooked arrivals on a typical day
    show_up_rate: float | None = None            # 1 - no_show_rate, for callers that want it
    partial_service_dates: list[date] = []       # dates where a partial per-service breakdown
                                                 # was set aside for the whole-business total

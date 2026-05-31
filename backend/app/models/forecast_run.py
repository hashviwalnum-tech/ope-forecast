from __future__ import annotations

from datetime import date as _date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ForecastRun(Base):
    """Snapshot of a forecast at the moment it was made.

    Storing this lets us compare predictions to actuals honestly later,
    rather than recomputing what the model 'would have said'.
    """

    __tablename__ = "forecast_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    target_date: Mapped[_date] = mapped_column(Date, index=True)
    predicted_value: Mapped[float]
    interval_low: Mapped[float]
    interval_high: Mapped[float]
    # Weights used per model at forecast time, e.g. {"seasonal_naive": 0.6, "wma": 0.4}
    model_weights: Mapped[dict] = mapped_column(JSON, default=dict)

"""
Persistence models for the self-tuning champion-challenger system.

TunerState  — one row per business.  Tracks the current champion meta-weight
              config, the active challenger (if any), when the shadow period
              started, and the previous champion kept for instant rollback.
              Invisible to end users; readable by developers via SQL or any
              DB browser.

TunerLog    — developer-visible audit trail.  Every shadow comparison result,
              every proposed challenger, every switch, and every rollback is
              appended here.  NOT surfaced in the app UI anywhere.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TunerState(Base):
    """One row per business — the live champion/challenger state."""

    __tablename__ = "tuner_state"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(
        ForeignKey("businesses.id"), unique=True, index=True
    )
    # Current live config: [w_recent, w_medium, w_year]
    champion_config: Mapped[list] = mapped_column(JSON, default=list)
    # Challenger running in shadow (None = no active challenger)
    challenger_config: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Date when the shadow period started (to compute shadow_days_count)
    challenger_started: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Previous champion kept for instant rollback after a switch
    previous_champion: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Previous champion's live MAE (baseline for rollback comparison)
    previous_champion_mae: Mapped[float | None] = mapped_column(nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class TunerLog(Base):
    """Developer-visible audit log — never shown to end users.

    Captures every significant event so a silent regression can be diagnosed.
    Lesson from prior incidents: a hidden mechanism that can degrade forecast
    quality must be inspectable.
    """

    __tablename__ = "tuner_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime)
    # One of: thin_data | no_change | challenger_proposed |
    #         shadow_comparison | switch | rollback
    event: Mapped[str] = mapped_column(String(64))
    # Human-readable description — what happened, why, and by how much
    details: Mapped[str] = mapped_column(Text, default="")
    # Config snapshots
    champion_config: Mapped[list | None] = mapped_column(JSON, nullable=True)
    challenger_config: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # MAE figures at the time of this event
    champion_mae: Mapped[float | None] = mapped_column(nullable=True)
    challenger_mae: Mapped[float | None] = mapped_column(nullable=True)
    # Number of shadow days that informed the decision (None for non-shadow events)
    shadow_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

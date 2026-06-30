from datetime import datetime
from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

TRIAL_DAYS = 30


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    tier: Mapped[str] = mapped_column(String(20), default="trial")  # "trial" | "premium" | "free"
    trial_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    subscription_status: Mapped[str] = mapped_column(String(20), default="none")  # "none" | "active" | "cancelled" | "expired"
    subscription_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    subscription_provider_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    renewal_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @property
    def effective_tier(self) -> str:
        """What tier this user actually has right now."""
        from datetime import timezone
        now = datetime.now(timezone.utc)
        # Active subscription → premium
        if self.subscription_status == "active":
            return "premium"
        # In trial → premium
        if self.tier == "trial" and self.trial_ends_at is not None:
            trial_end = self.trial_ends_at
            if trial_end.tzinfo is None:
                trial_end = trial_end.replace(tzinfo=timezone.utc)
            if now < trial_end:
                return "premium"
        return "free"

    @property
    def trial_days_remaining(self) -> int | None:
        """Days left in trial, or None if not in trial."""
        if self.tier != "trial" or self.trial_ends_at is None:
            return None
        from datetime import timezone
        now = datetime.now(timezone.utc)
        trial_end = self.trial_ends_at
        if trial_end.tzinfo is None:
            trial_end = trial_end.replace(tzinfo=timezone.utc)
        delta = (trial_end - now).days
        return max(0, delta)

from datetime import datetime
from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base
from app import clock

TRIAL_DAYS = 30


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    tier: Mapped[str] = mapped_column(String(20), default="trial")  # "trial" | "premium" | "free"
    trial_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # "none" | "active" | "grace" | "on_hold" | "paused" | "cancelled" | "expired"
    # | "pending" | "unknown" — see app/billing/entitlement.py for what each means.
    subscription_status: Mapped[str] = mapped_column(String(20), default="none")
    subscription_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)  # "google_play"
    # The Play purchase token.  Text, not String(200): Google documents no
    # maximum length, and a truncated token is a subscription nobody can verify.
    subscription_provider_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    play_product_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Paid-through date: when the current paid period ends (and, if renewing,
    # when Google next charges).
    renewal_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Manual grant for pilot businesses, set only behind ADMIN_KEY.  Only ever
    # adds premium; never takes it away from a paying owner.
    manual_grant: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    manual_grant_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @property
    def effective_tier(self) -> str:
        """What tier this user actually has right now.  The rule itself is in
        app/billing/entitlement.py, so it can be tested without a database."""
        from app.billing.entitlement import is_premium
        premium = is_premium(
            clock.now_utc(),
            tier=self.tier,
            trial_ends_at=self.trial_ends_at,
            status=self.subscription_status or "none",
            paid_through=self.renewal_at,
            granted=bool(self.manual_grant),
            grant_ends_at=self.manual_grant_ends_at,
        )
        return "premium" if premium else "free"

    @property
    def play_account_id(self) -> str:
        """Passed by the phone to Google so a purchase is tied to this account."""
        from app.billing.play_state import play_account_id
        return play_account_id(self.user_id)

    @property
    def trial_days_remaining(self) -> int | None:
        """Days left in trial, or None if not in trial."""
        if self.tier != "trial" or self.trial_ends_at is None:
            return None
        from datetime import timezone
        now = clock.now_utc()
        trial_end = self.trial_ends_at
        if trial_end.tzinfo is None:
            trial_end = trial_end.replace(tzinfo=timezone.utc)
        delta = (trial_end - now).days
        return max(0, delta)

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    # opening_days (list[int] 0-6), default_lead_time_days, target_service_level, etc.
    #
    # NOTE: settings may still carry a legacy "tier" key, and carries
    # "tier_admin_override"/"tier" as the deliberate manual-grant path. Neither
    # is the tier. There is deliberately **no `.tier` property here**: it used to
    # read settings["tier"], a cache that only some code paths refreshed, and
    # every entitlement leak found in testing was code reading that cache
    # without refreshing it first — a trial that never ended, and three Telegram
    # bot gates serving premium to expired accounts.
    #
    # The tier is now obtained only from `app.api.deps.resolve_tier`, which reads
    # the subscription, and is passed explicitly as an `app.engine.limits.Tier`.
    # Anything that reaches for `biz.tier` now fails loudly instead of quietly
    # returning stale state.
    settings: Mapped[dict] = mapped_column(JSON, default=dict)

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    # opening_days (list[int] 0-6), default_lead_time_days, target_service_level, etc.
    # Also stores "tier": "free"|"premium" for limit gating.
    settings: Mapped[dict] = mapped_column(JSON, default=dict)

    @property
    def tier(self) -> str:
        if self.settings:
            return self.settings.get("tier", "free")
        return "free"

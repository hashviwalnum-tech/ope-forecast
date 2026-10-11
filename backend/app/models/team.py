"""Team access: staff who log sales for a business they do not own.

The owner is still `Business.user_id` and nothing about owners changes. A staff
member is a row here. What staff may do is decided in one place,
`app/api/deps.py` — every route is owner-only unless it explicitly asks for
`get_business_staff_ok`, so a route nobody thought about is closed to staff,
never open.

Both tables are new, created at startup; no existing table changed.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app import clock
from app.models.base import Base


def _utcnow() -> datetime:
    return clock.now_naive_utc()


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("business_id", "user_id", name="uq_team_member"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), nullable=False, index=True)
    # The staff member's own sign-in (Supabase user id).
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # So the owner can see who joined. Shown only to the owner.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="staff")
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class TeamInvite(Base):
    """One join code per business at a time; a new one replaces the old.

    Only a hash is stored: the code is shown to the owner once, when it is made.
    It can be used by several staff until it expires (a café rarely adds one
    barista at a time).
    """
    __tablename__ = "team_invites"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), nullable=False, unique=True, index=True)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

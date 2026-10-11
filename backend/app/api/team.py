"""Team access: the owner invites staff with a code; staff log sales.

POST   /team/invite              owner: make a join code (replaces any earlier one)
GET    /team                     owner: who is on the team, and whether a code is live
DELETE /team/members/{id}        owner: remove someone — takes effect on their next tap
POST   /team/join                anyone signed in: join with a code
DELETE /team/membership/{biz_id} staff: leave a team

Joining is by code, not email: Ope cannot send email yet, and a code the owner
reads out across the counter is how a café would do it anyway. The code is
8 characters from 31 unambiguous ones (~8.5e11 combinations) and lives 24
hours, so guessing one is not a practical attack; only its hash is stored.

Team access is Premium, judged on the OWNER's plan. During the free pilot the
owner's business is granted Premium by hand (see docs/OPERATIONS.md).
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import clock
from app.api.deps import get_business, get_current_email, get_current_user, resolve_tier
from app.api.errors import CodedHTTPException
from app.db import get_db
from app.models import Business
from app.models.team import TeamInvite, TeamMember

router = APIRouter(prefix="/team", tags=["Team"])

INVITE_HOURS = 24
# No 0/O, 1/I/L: read aloud or copied off a screen, they get confused.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE_LEN = 8


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def normalise_code(raw: str) -> str:
    """What the person typed, as the code it was meant to be: case and the
    dash or spaces in "ABCD-EFGH" do not matter."""
    return "".join(ch for ch in raw.upper() if ch.isalnum())


class InviteRead(BaseModel):
    code: str                 # shown once; only its hash is kept
    expires_at: datetime


class MemberRead(BaseModel):
    id: int
    email: str | None
    joined_at: datetime


class TeamRead(BaseModel):
    members: list[MemberRead]
    invite_expires_at: datetime | None    # a live code exists until then
    available: bool                       # the owner's plan includes team access


class JoinBody(BaseModel):
    code: str


class JoinedRead(BaseModel):
    business_id: int
    business_name: str


def _require_team_plan(db: Session, owner_user_id: str) -> None:
    if not resolve_tier(db, owner_user_id).is_premium:
        raise CodedHTTPException(
            403, "Team access is part of Premium.", "team_needs_premium",
        )


@router.post("/invite", response_model=InviteRead)
def make_invite(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    _require_team_plan(db, biz.user_id)
    code = "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LEN))
    expires = clock.now_naive_utc() + timedelta(hours=INVITE_HOURS)
    db.query(TeamInvite).filter_by(business_id=biz.id).delete(synchronize_session=False)
    db.add(TeamInvite(business_id=biz.id, code_hash=_hash(code), expires_at=expires))
    db.commit()
    return InviteRead(code=f"{code[:4]}-{code[4:]}", expires_at=expires)


@router.get("", response_model=TeamRead)
def get_team(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    members = db.query(TeamMember).filter_by(business_id=biz.id).order_by(TeamMember.id).all()
    invite = db.query(TeamInvite).filter_by(business_id=biz.id).first()
    live = invite is not None and invite.expires_at > clock.now_naive_utc()
    return TeamRead(
        members=[MemberRead(id=m.id, email=m.email, joined_at=m.joined_at) for m in members],
        invite_expires_at=invite.expires_at if live else None,
        available=resolve_tier(db, biz.user_id).is_premium,
    )


@router.delete("/members/{member_id}", status_code=204)
def remove_member(member_id: int, db: Session = Depends(get_db),
                  biz: Business = Depends(get_business)):
    m = db.get(TeamMember, member_id)
    if m is None or m.business_id != biz.id:
        raise HTTPException(404, "Team member not found")
    db.delete(m)
    db.commit()


@router.post("/join", response_model=JoinedRead)
def join(body: JoinBody, db: Session = Depends(get_db),
         user_id: str = Depends(get_current_user),
         email: str | None = Depends(get_current_email)):
    code = normalise_code(body.code)
    invite = (db.query(TeamInvite).filter_by(code_hash=_hash(code)).first()
              if len(code) == _CODE_LEN else None)
    if invite is None or invite.expires_at <= clock.now_naive_utc():
        raise CodedHTTPException(
            404, "That code did not work. Check it with the owner — codes last 24 hours.",
            "team_code_invalid",
        )
    biz = db.get(Business, invite.business_id)
    if biz is None:
        raise CodedHTTPException(404, "That code did not work.", "team_code_invalid")
    if biz.user_id == user_id:
        raise CodedHTTPException(
            400, "This is your own business — you already have full access.", "team_own_business",
        )
    _require_team_plan(db, biz.user_id)
    existing = db.query(TeamMember).filter_by(business_id=biz.id, user_id=user_id).first()
    if existing is None:
        db.add(TeamMember(business_id=biz.id, user_id=user_id, email=email, role="staff"))
        db.commit()
    return JoinedRead(business_id=biz.id, business_name=biz.name)


@router.delete("/membership/{business_id}", status_code=204)
def leave(business_id: int, db: Session = Depends(get_db),
          user_id: str = Depends(get_current_user)):
    m = db.query(TeamMember).filter_by(business_id=business_id, user_id=user_id).first()
    if m is None:
        raise HTTPException(404, "You are not on that team")
    db.delete(m)
    db.commit()

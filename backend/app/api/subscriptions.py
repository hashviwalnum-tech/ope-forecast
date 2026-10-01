import logging
from datetime import timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import clock
from app.api.deps import get_current_user, require_admin_key
from app.billing.google_play import PROVIDER, PlayClient, PlayError, get_play_client, sync_from_google
from app.db import get_db
from app.models.subscription import Subscription, TRIAL_DAYS
from app.schemas.subscription import GrantRequest, SubscriptionRead

log = logging.getLogger(__name__)

router = APIRouter(tags=["Subscriptions"])


def _get_or_create_subscription(user_id: str, db: Session) -> Subscription:
    """Get existing subscription or auto-create a trial for the user."""
    sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    if sub is None:
        now = clock.now_utc()
        sub = Subscription(
            user_id=user_id,
            tier="trial",
            trial_started_at=now,
            trial_ends_at=now + timedelta(days=TRIAL_DAYS),
            subscription_status="none",
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
    return sub


@router.get("/subscription", response_model=SubscriptionRead)
def get_subscription(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
    play: PlayClient | None = Depends(get_play_client),
):
    # Nothing to write back: the tier is no longer cached on the business, so a
    # subscription change takes effect on the very next gated request without
    # anything having to notice.  That is what removes the whole class of
    # "premium kept working after the trial ended" bug.
    sub = _get_or_create_subscription(user_id, db)
    if play is not None and _worth_asking_google(sub):
        # Belt and braces behind Google's notifications: if the paid period
        # has run out (or the account is in a grace/hold state) and we have
        # heard nothing, ask.  Never fatal — a Google outage must not stop the
        # owner seeing their account.
        try:
            sync_from_google(db, sub, play, sub.subscription_provider_id)
        except PlayError as e:
            log.warning("Play refresh failed for %s: %s", user_id, e)
            db.rollback()
        db.refresh(sub)
    return sub


def _worth_asking_google(sub: Subscription) -> bool:
    if sub.subscription_provider != PROVIDER or not sub.subscription_provider_id:
        return False
    if sub.subscription_status in ("grace", "on_hold", "paused", "pending"):
        return True
    if sub.subscription_status in ("active", "cancelled") and sub.renewal_at is not None:
        paid = sub.renewal_at
        if paid.tzinfo is None:
            paid = paid.replace(tzinfo=timezone.utc)
        return clock.now_utc() >= paid
    return False


# ── Admin: manual grants (pilot businesses) ──────────────────────────────────
#
# A grant sits in its own two columns on the same Subscription row.  It can only
# ADD premium: revoking a grant clears those columns and nothing else, so an
# owner who is also paying through Google keeps premium regardless.

@router.post("/admin/grants", response_model=SubscriptionRead)
def grant_premium(
    body: GrantRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_key),
):
    if not body.user_id.strip():
        raise HTTPException(400, "user_id is required")
    sub = _get_or_create_subscription(body.user_id.strip(), db)
    sub.manual_grant = True
    sub.manual_grant_ends_at = body.ends_at
    sub.updated_at = clock.now_utc()
    db.commit()
    db.refresh(sub)
    return sub


@router.delete("/admin/grants/{user_id}", response_model=SubscriptionRead)
def revoke_grant(
    user_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_key),
):
    sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    if sub is None:
        raise HTTPException(404, "No account with that user id")
    sub.manual_grant = False
    sub.manual_grant_ends_at = None
    sub.updated_at = clock.now_utc()
    db.commit()
    db.refresh(sub)
    return sub


# ── Admin: "follow the cash" ──────────────────────────────────────────────────

@router.get("/admin/subscriptions")
def admin_subscriptions(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_key),
):
    """Admin-only: all subscriptions with trial/subscriber/revenue stats."""
    subs = db.query(Subscription).order_by(Subscription.created_at.desc()).all()
    now = clock.now_utc()

    rows = []
    for s in subs:
        eff = s.effective_tier
        trial_end = s.trial_ends_at
        if trial_end is not None and trial_end.tzinfo is None:
            trial_end = trial_end.replace(tzinfo=timezone.utc)
        in_trial = (s.tier == "trial" and trial_end is not None and trial_end > now)
        rows.append({
            "user_id": s.user_id,
            "tier": s.tier,
            "effective_tier": eff,
            "in_trial": in_trial,
            "trial_started_at": s.trial_started_at.isoformat() if s.trial_started_at else None,
            "trial_ends_at": s.trial_ends_at.isoformat() if s.trial_ends_at else None,
            "subscription_status": s.subscription_status,
            "subscription_provider": s.subscription_provider,
            "renewal_at": s.renewal_at.isoformat() if s.renewal_at else None,
            "manual_grant": bool(s.manual_grant),
            "manual_grant_ends_at": s.manual_grant_ends_at.isoformat() if s.manual_grant_ends_at else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    in_trial_count = sum(1 for r in rows if r["in_trial"])
    active_count = sum(1 for r in rows if r["subscription_status"] in ("active", "grace"))
    converted = sum(1 for s in subs if s.subscription_provider == PROVIDER)

    return {
        "summary": {
            "total_accounts": len(rows),
            "in_trial": in_trial_count,
            "active_subscribers": active_count,
            "manual_grants": sum(1 for r in rows if r["manual_grant"]),
            "converted": converted,
            "conversion_rate_pct": round(converted / len(rows) * 100, 1) if rows else 0,
        },
        "subscriptions": rows,
    }

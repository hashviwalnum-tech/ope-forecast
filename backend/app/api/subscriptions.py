import os
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app import clock
from app.api.deps import get_current_user, require_admin_key
from app.billing.provider import payment_provider
from app.db import get_db
from app.models import Business
from app.models.subscription import Subscription, TRIAL_DAYS
from app.schemas.subscription import (
    CheckoutRequest, CheckoutResponse, SubscriptionRead, WebhookEvent
)

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


def _sync_business_tier(user_id: str, effective_tier: str, db: Session) -> None:
    """Keep Business.settings['tier'] in sync with effective tier (for limit checks)."""
    from sqlalchemy.orm.attributes import flag_modified
    businesses = db.query(Business).filter(Business.user_id == user_id).all()
    for biz in businesses:
        settings = dict(biz.settings or {})
        # Don't override if admin has manually set a different tier
        if settings.get("tier") in ("free", "premium") and settings.get("tier_admin_override"):
            continue
        if settings.get("tier") != effective_tier:
            settings["tier"] = effective_tier
            biz.settings = settings
            flag_modified(biz, "settings")
    db.commit()


@router.get("/subscription", response_model=SubscriptionRead)
def get_subscription(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    sub = _get_or_create_subscription(user_id, db)
    effective = sub.effective_tier
    _sync_business_tier(user_id, effective, db)
    return sub


@router.post("/subscription/checkout", response_model=CheckoutResponse)
def start_checkout(
    body: CheckoutRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    if body.plan not in ("monthly", "annual"):
        raise HTTPException(400, "plan must be 'monthly' or 'annual'")
    result = payment_provider.start_checkout(
        user_id=user_id,
        plan=body.plan,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
    )
    return CheckoutResponse(checkout_url=result.checkout_url)


@router.post("/subscription/cancel", response_model=SubscriptionRead)
def cancel_subscription(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    if not sub or sub.subscription_status != "active":
        raise HTTPException(400, "No active subscription to cancel.")
    if sub.subscription_provider_id:
        payment_provider.cancel_subscription(sub.subscription_provider_id)
    sub.subscription_status = "cancelled"
    sub.updated_at = clock.now_utc()
    db.commit()
    db.refresh(sub)
    _sync_business_tier(user_id, sub.effective_tier, db)
    return sub


@router.post("/subscription/webhook")
async def payment_webhook(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_key),
):
    """Receive payment provider webhooks (admin key required for security)."""
    body = await request.body()
    sig = request.headers.get("X-Webhook-Signature", "")
    event = payment_provider.verify_webhook(body, sig)
    # Normalize and apply: stub returns {} so this is a no-op until real provider
    if event.get("type") == "subscription.activated":
        user_id = event.get("user_id", "")
        sub_id = event.get("subscription_id", "")
        renewal = event.get("renewal_at")
        sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
        if sub and user_id:
            sub.tier = "premium"
            sub.subscription_status = "active"
            sub.subscription_provider_id = sub_id
            sub.renewal_at = renewal
            sub.updated_at = clock.now_utc()
            db.commit()
            _sync_business_tier(user_id, "premium", db)
    elif event.get("type") == "subscription.cancelled":
        user_id = event.get("user_id", "")
        sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
        if sub and user_id:
            sub.subscription_status = "cancelled"
            sub.updated_at = clock.now_utc()
            db.commit()
            _sync_business_tier(user_id, sub.effective_tier, db)
    return {"ok": True}


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
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    in_trial_count = sum(1 for r in rows if r["in_trial"])
    active_count = sum(1 for r in rows if r["subscription_status"] == "active")
    converted = sum(1 for r in rows if r["subscription_status"] in ("active", "cancelled"))

    return {
        "summary": {
            "total_accounts": len(rows),
            "in_trial": in_trial_count,
            "active_subscribers": active_count,
            "converted": converted,
            "conversion_rate_pct": round(converted / len(rows) * 100, 1) if rows else 0,
        },
        "subscriptions": rows,
    }

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import get_business, get_current_user, get_tier, require_admin_key, resolve_tier
from app.engine.limits import FREE, PREMIUM, Tier
from app.db import get_db
from app.models import BookedCount, Business, DayRecord, ForecastRun, Period, Product, RecurringPattern, Regular, SaleEvent, SaleRecord, ServiceBookedCount
from app import clock

FREE_BUSINESS_LIMIT = 1  # §10: free = one location; premium = more

router = APIRouter(prefix="/businesses", tags=["Businesses"])


class BusinessCreate(BaseModel):
    name: str


class BusinessRead(BaseModel):
    id: int
    name: str
    settings: dict
    # Resolved from the subscription at request time and set explicitly — it is
    # NOT read off the model, which no longer has a `.tier` at all.
    tier: str
    model_config = {"from_attributes": True}


def _read(biz: Business, tier: Tier) -> BusinessRead:
    """Serialise a business with an explicitly resolved tier."""
    return BusinessRead(id=biz.id, name=biz.name, settings=biz.settings or {}, tier=str(tier))


class TierUpdate(BaseModel):
    tier: str


class BusinessSettingsUpdate(BaseModel):
    opening_days: list[int] | None = None           # 0=Mon … 6=Sun
    opening_hour: int | None = Field(None, ge=0, le=23)   # 0–23 in LOCAL time
    closing_hour: int | None = Field(None, ge=0, le=23)   # 0–23 in LOCAL time
    timezone: str | None = None                     # IANA tz name e.g. "Asia/Jerusalem"
    avg_service_time_minutes: float | None = None   # minutes to serve one customer
    staffing_max_wait_minutes: float | None = None  # owner's max acceptable wait (None = use utilisation cap)
    staffing_max_queue_length: float | None = None  # owner's max queue length (None = use utilisation cap)
    stock_management_enabled: bool | None = None    # toggle to hide ordering/stock advice entirely
    assume_orders_arrive_on_time: bool | None = None  # auto-mark pending orders as arrived on expected date
    onboarding_done: bool | None = None             # persisted server-side so it survives across devices
    nudges_enabled: bool | None = None             # enable/disable all proactive nudges (Telegram + in-app)
    nudge_frequency_hours: int | None = Field(None, ge=1, le=168)  # min hours between Telegram nudges
    appointment_based: bool | None = None           # owner takes appointments — blend booked counts into the forecast


@router.get("", response_model=list[BusinessRead])
def list_businesses(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    tier = resolve_tier(db, user_id)
    rows = db.query(Business).filter(Business.user_id == user_id).order_by(Business.id).all()
    return [_read(b, tier) for b in rows]


@router.get("/me", response_model=BusinessRead)
def get_my_business(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    tier = resolve_tier(db, user_id)
    biz = db.query(Business).filter(Business.user_id == user_id).order_by(Business.id).first()
    if not biz:
        raise HTTPException(404, "No business yet")
    return _read(biz, tier)


@router.patch("/me/settings", response_model=BusinessRead)
def update_settings(
    body: BusinessSettingsUpdate,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
    tier: Tier = Depends(get_tier),
):
    merged = {**(biz.settings or {}), **body.model_dump(exclude_none=True)}
    # Allow clearing staffing threshold fields when the client explicitly sends null.
    # model_dump(exclude_none=True) drops null values, so a switch from 'wait' to
    # 'queue' would leave the old staffing_max_wait_minutes in settings and both
    # thresholds would be active (wait-threshold wins in _recommended_staff).
    # Fix: check model_fields_set to distinguish "not sent" from "sent as null".
    for field in ('staffing_max_wait_minutes', 'staffing_max_queue_length'):
        if field in body.model_fields_set and getattr(body, field) is None:
            merged.pop(field, None)
    biz.settings = merged
    flag_modified(biz, "settings")
    db.commit()
    db.refresh(biz)
    return _read(biz, tier)


@router.post("", response_model=BusinessRead, status_code=201)
def create_business(
    body: BusinessCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    tier = resolve_tier(db, user_id)   # authoritative, read now (§10)
    existing = db.query(Business).filter(Business.user_id == user_id).all()
    if not tier.is_premium and len(existing) >= FREE_BUSINESS_LIMIT:
        raise HTTPException(
            status_code=403,
            detail="Multiple locations require a premium plan. Upgrade in Settings.",
        )
    biz = Business(name=body.name.strip(), user_id=user_id, settings={})
    db.add(biz)
    db.commit()
    db.refresh(biz)

    # Auto-start trial for new users (first business creation)
    if len(existing) == 0:
        from app.models.subscription import Subscription, TRIAL_DAYS
        from datetime import datetime, timedelta, timezone
        existing_sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
        if existing_sub is None:
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
            db.refresh(biz)
            # NOTE: nothing writes a tier onto the business any more.  The trial
            # grants premium purely by existing — resolve_tier reads the
            # subscription — so there is no cached flag left to go stale when it
            # expires, which is what leaked before.

    return _read(biz, resolve_tier(db, user_id))


@router.post("/{source_id}/copy", response_model=BusinessRead, status_code=201)
def copy_business(
    source_id: int,
    body: BusinessCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    """Create a new location by copying settings + products from source_id.
    Premium required. History and sales data are NOT copied — only config and product list.
    """
    source = db.query(Business).filter(
        Business.id == source_id, Business.user_id == user_id
    ).first()
    if not source:
        raise HTTPException(404, "Source location not found")

    tier = resolve_tier(db, user_id)   # authoritative, read now (§10)
    if not tier.is_premium:
        raise HTTPException(
            status_code=403,
            detail="Multiple locations require a premium plan. Upgrade in Settings.",
        )

    new_settings = dict(source.settings or {})
    new_biz = Business(name=body.name.strip(), user_id=user_id, settings=new_settings)
    db.add(new_biz)
    db.flush()

    source_products = db.query(Product).filter(Product.business_id == source_id).all()
    id_map: dict[int, int] = {}
    for p in source_products:
        copy = Product(
            business_id=new_biz.id,
            name=p.name,
            unit=p.unit,
            # product_type MUST be copied: without it a service (a massage, a
            # party package) landed at the new location as a 'stocked' good with
            # no lead time — an invalid product the new location would then be
            # told to reorder.
            product_type=p.product_type or "stocked",
            unit_mode=p.unit_mode or "whole",
            is_favorite=p.is_favorite,
            price=p.price,
            lead_time_days=p.lead_time_days,
            current_stock=None,          # per-location data — not copied
            service_time_minutes=p.service_time_minutes,
            storage_capacity=p.storage_capacity,
            shelf_life_days=p.shelf_life_days,
        )
        db.add(copy)
        db.flush()
        id_map[p.id] = copy.id

    # A service's supplies are part of its configuration, not its data, so they
    # come along too — otherwise the copied location silently stops drawing down
    # stock when that service is performed.
    from app.models.service_consumable import ServiceConsumable
    for link in db.query(ServiceConsumable).filter(
        ServiceConsumable.service_product_id.in_(id_map.keys() or [-1])
    ).all():
        if link.service_product_id in id_map and link.consumable_product_id in id_map:
            db.add(ServiceConsumable(
                business_id=new_biz.id,
                service_product_id=id_map[link.service_product_id],
                consumable_product_id=id_map[link.consumable_product_id],
                qty_per_performance=link.qty_per_performance,
            ))

    db.commit()
    db.refresh(new_biz)
    return _read(new_biz, tier)


@router.delete("/{business_id}", status_code=204)
def delete_business(
    business_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    """Delete a location and all its data.  Requires at least one location to remain."""
    all_biz = db.query(Business).filter(Business.user_id == user_id).all()
    if len(all_biz) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete your only location. Create another one first.",
        )
    biz = next((b for b in all_biz if b.id == business_id), None)
    if not biz:
        raise HTTPException(404, "Location not found")

    # Cascade-delete all business data manually (SQLite doesn't enforce FK cascades)
    day_ids = [r.id for r in db.query(DayRecord).filter_by(business_id=business_id).all()]
    if day_ids:
        db.query(SaleRecord).filter(SaleRecord.day_record_id.in_(day_ids)).delete(synchronize_session=False)
    db.query(DayRecord).filter_by(business_id=business_id).delete()
    db.query(SaleEvent).filter_by(business_id=business_id).delete()
    db.query(Period).filter_by(business_id=business_id).delete()
    db.query(RecurringPattern).filter_by(business_id=business_id).delete()
    db.query(Regular).filter_by(business_id=business_id).delete()
    db.query(Product).filter_by(business_id=business_id).delete()
    db.query(ForecastRun).filter_by(business_id=business_id).delete()
    db.query(BookedCount).filter_by(business_id=business_id).delete()
    db.query(ServiceBookedCount).filter_by(business_id=business_id).delete()
    db.delete(biz)
    db.commit()


@router.patch("/me/tier", response_model=BusinessRead)
def set_tier(
    body: TierUpdate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
    _: None = Depends(require_admin_key),
):
    """Admin-only: set the account tier for all of this user's businesses.

    Requires the X-Admin-Key header matching the ADMIN_KEY environment variable.
    Normal users cannot call this endpoint. Billing (Phase 3.5) will replace this
    with a Stripe-verified grant path.
    """
    if body.tier not in ("free", "premium"):
        raise HTTPException(400, "tier must be 'free' or 'premium'")
    all_biz = db.query(Business).filter(Business.user_id == user_id).all()
    if not all_biz:
        raise HTTPException(404, "No businesses found for this account")
    for biz in all_biz:
        settings = dict(biz.settings or {})
        settings["tier"] = body.tier
        # Mark it as a deliberate override so the live-tier sync leaves it alone
        # (this is the manual grant path used for testing until billing lands).
        settings["tier_admin_override"] = True
        biz.settings = settings
        flag_modified(biz, "settings")
    db.commit()
    first = db.query(Business).filter(Business.user_id == user_id).order_by(Business.id).first()
    return _read(first, resolve_tier(db, user_id))

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import get_business, get_current_user
from app.db import get_db
from app.models import Business, Product

FREE_BUSINESS_LIMIT = 1  # §10: free = one location; premium = more

router = APIRouter(prefix="/businesses", tags=["Businesses"])


class BusinessCreate(BaseModel):
    name: str


class BusinessRead(BaseModel):
    id: int
    name: str
    settings: dict
    tier: str
    model_config = {"from_attributes": True}


class TierUpdate(BaseModel):
    tier: str


class BusinessSettingsUpdate(BaseModel):
    opening_days: list[int] | None = None           # 0=Mon … 6=Sun
    opening_hour: int | None = None                 # 0–23
    closing_hour: int | None = None                 # 0–23
    avg_service_time_minutes: float | None = None   # minutes to serve one customer


@router.get("", response_model=list[BusinessRead])
def list_businesses(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    return db.query(Business).filter(Business.user_id == user_id).order_by(Business.id).all()


@router.get("/me", response_model=BusinessRead)
def get_my_business(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    biz = db.query(Business).filter(Business.user_id == user_id).order_by(Business.id).first()
    if not biz:
        raise HTTPException(404, "No business yet")
    return biz


@router.patch("/me/settings", response_model=BusinessRead)
def update_settings(
    body: BusinessSettingsUpdate,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    merged = {**(biz.settings or {}), **body.model_dump(exclude_none=True)}
    biz.settings = merged
    flag_modified(biz, "settings")
    db.commit()
    db.refresh(biz)
    return biz


@router.post("", response_model=BusinessRead, status_code=201)
def create_business(
    body: BusinessCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    existing = db.query(Business).filter(Business.user_id == user_id).all()
    is_premium = any(b.tier == "premium" for b in existing)
    if not is_premium and len(existing) >= FREE_BUSINESS_LIMIT:
        raise HTTPException(
            status_code=403,
            detail="Multiple locations require a premium plan. Upgrade in Settings.",
        )
    biz = Business(name=body.name.strip(), user_id=user_id, settings={})
    db.add(biz)
    db.commit()
    db.refresh(biz)
    return biz


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

    all_biz = db.query(Business).filter(Business.user_id == user_id).all()
    is_premium = any(b.tier == "premium" for b in all_biz)
    if not is_premium:
        raise HTTPException(
            status_code=403,
            detail="Multiple locations require a premium plan. Upgrade in Settings.",
        )

    new_settings = dict(source.settings or {})
    new_biz = Business(name=body.name.strip(), user_id=user_id, settings=new_settings)
    db.add(new_biz)
    db.flush()

    source_products = db.query(Product).filter(Product.business_id == source_id).all()
    for p in source_products:
        db.add(Product(
            business_id=new_biz.id,
            name=p.name,
            unit=p.unit,
            unit_mode=p.unit_mode or "whole",
            price=p.price,
            lead_time_days=p.lead_time_days,
            current_stock=None,          # per-location data — not copied
            service_time_minutes=p.service_time_minutes,
            storage_capacity=p.storage_capacity,
            shelf_life_days=p.shelf_life_days,
        ))

    db.commit()
    db.refresh(new_biz)
    return new_biz


@router.patch("/me/tier", response_model=BusinessRead)
def set_tier(
    body: TierUpdate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    """Set the account tier for all of this user's businesses.

    Accepts 'free' or 'premium'. Use this during testing to switch tiers
    without going through billing. Billing in Phase 3.5 will own this field.
    """
    if body.tier not in ("free", "premium"):
        raise HTTPException(400, "tier must be 'free' or 'premium'")
    all_biz = db.query(Business).filter(Business.user_id == user_id).all()
    if not all_biz:
        raise HTTPException(404, "No businesses found for this account")
    for biz in all_biz:
        settings = dict(biz.settings or {})
        settings["tier"] = body.tier
        biz.settings = settings
        flag_modified(biz, "settings")
    db.commit()
    first = db.query(Business).filter(Business.user_id == user_id).order_by(Business.id).first()
    return first

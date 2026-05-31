from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import get_current_user
from app.db import get_db
from app.models import Business

router = APIRouter(prefix="/businesses", tags=["Businesses"])


class BusinessCreate(BaseModel):
    name: str


class BusinessRead(BaseModel):
    id: int
    name: str
    settings: dict
    model_config = {"from_attributes": True}


class BusinessSettingsUpdate(BaseModel):
    opening_days: list[int] | None = None  # 0=Mon … 6=Sun
    opening_hour: int | None = None        # 0–23
    closing_hour: int | None = None        # 0–23


@router.get("/me", response_model=BusinessRead)
def get_my_business(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    biz = db.query(Business).filter(Business.user_id == user_id).first()
    if not biz:
        raise HTTPException(404, "No business yet")
    return biz


@router.patch("/me/settings", response_model=BusinessRead)
def update_settings(
    body: BusinessSettingsUpdate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    biz = db.query(Business).filter(Business.user_id == user_id).first()
    if not biz:
        raise HTTPException(404, "No business yet")
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
    if db.query(Business).filter(Business.user_id == user_id).first():
        raise HTTPException(409, "You already have a business")
    biz = Business(name=body.name, user_id=user_id, settings={})
    db.add(biz)
    db.commit()
    db.refresh(biz)
    return biz

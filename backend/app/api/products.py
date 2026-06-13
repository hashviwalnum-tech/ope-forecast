from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import Business, Product, SaleRecord, SaleEvent
from app.schemas.product import ProductCreate, ProductRead, ProductUpdate

router = APIRouter(prefix="/products", tags=["Products"])


def _get_or_404(db: Session, product_id: int, biz_id: int) -> Product:
    row = db.get(Product, product_id)
    if not row or row.business_id != biz_id:
        raise HTTPException(404, "Product not found")
    return row


@router.get("", response_model=list[ProductRead])
def list_products(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return db.query(Product).filter_by(business_id=biz.id).all()


@router.post("", response_model=ProductRead, status_code=201)
def create_product(body: ProductCreate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    data = body.model_dump()
    if data.get("current_stock") is not None:
        data["stock_as_of_date"] = _date.today()
    row = Product(business_id=biz.id, **data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return _get_or_404(db, product_id, biz.id)


@router.put("/{product_id}", response_model=ProductRead)
def update_product(product_id: int, body: ProductUpdate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, product_id, biz.id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    # Auto-advance the stock baseline date whenever current_stock is explicitly set
    if "current_stock" in body.model_fields_set and body.current_stock is not None:
        row.stock_as_of_date = _date.today()
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, product_id, biz.id)
    # Remove associated sale records (FK — no cascade on SQLite/Postgres without explicit rule)
    db.query(SaleRecord).filter(SaleRecord.product_id == product_id).delete(synchronize_session=False)
    # Null out product_id on sale events (product_id is nullable there)
    db.query(SaleEvent).filter(SaleEvent.product_id == product_id).update(
        {"product_id": None}, synchronize_session=False
    )
    db.delete(row)
    db.commit()

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import Business, Product
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
    row = Product(business_id=biz.id, **body.model_dump())
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
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, product_id, biz.id)
    db.delete(row)
    db.commit()

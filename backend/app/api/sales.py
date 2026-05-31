from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import Business, DayRecord, Product, SaleRecord
from app.schemas.sale import SaleCreate, SaleRead, SaleUpdate

router = APIRouter(prefix="/sales", tags=["Sales"])


def _get_or_404(db: Session, sale_id: int, biz_id: int) -> SaleRecord:
    row = db.get(SaleRecord, sale_id)
    if not row:
        raise HTTPException(404, "Sale record not found")
    dr = db.get(DayRecord, row.day_record_id)
    if not dr or dr.business_id != biz_id:
        raise HTTPException(404, "Sale record not found")
    return row


@router.get("", response_model=list[SaleRead])
def list_sales(
    day_record_id: int | None = None,
    product_id: int | None = None,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    q = db.query(SaleRecord).join(DayRecord).filter(DayRecord.business_id == biz.id)
    if day_record_id is not None:
        q = q.filter(SaleRecord.day_record_id == day_record_id)
    if product_id is not None:
        q = q.filter(SaleRecord.product_id == product_id)
    return q.all()


@router.post("", response_model=SaleRead, status_code=201)
def create_sale(body: SaleCreate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    dr = db.get(DayRecord, body.day_record_id)
    if not dr or dr.business_id != biz.id:
        raise HTTPException(404, "Day record not found")
    product = db.get(Product, body.product_id)
    if not product or product.business_id != biz.id:
        raise HTTPException(404, "Product not found")
    row = SaleRecord(**body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{sale_id}", response_model=SaleRead)
def get_sale(sale_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return _get_or_404(db, sale_id, biz.id)


@router.put("/{sale_id}", response_model=SaleRead)
def update_sale(sale_id: int, body: SaleUpdate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, sale_id, biz.id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{sale_id}", status_code=204)
def delete_sale(sale_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, sale_id, biz.id)
    db.delete(row)
    db.commit()

from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_business
from app.db import get_db
from app.models import Business, Product, SaleRecord, SaleEvent, ServiceBookedCount
from app.models.service_consumable import ServiceConsumable
from app.models.stock_batch import StockBatch
from app.schemas.product import ProductCreate, ProductRead, ProductUpdate
from app.schemas.service_consumable import ServiceConsumableCreate, ServiceConsumableRead

router = APIRouter(prefix="/products", tags=["Products"])


def _get_or_404(db: Session, product_id: int, biz_id: int) -> Product:
    row = db.get(Product, product_id)
    if not row or row.business_id != biz_id:
        raise HTTPException(404, "Product not found")
    return row


@router.get("", response_model=list[ProductRead])
def list_products(db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return db.query(Product).filter_by(business_id=biz.id).all()


def _create_initial_batch(
    db: Session,
    product: Product,
    quantity: float,
    today: _date,
) -> None:
    """Create the initial stock batch for a product's starting inventory."""
    from datetime import timedelta
    expiry = (
        today + timedelta(days=product.shelf_life_days)
        if product.shelf_life_days is not None
        else None
    )
    batch = StockBatch(
        business_id=product.business_id,
        product_id=product.id,
        quantity_initial=quantity,
        quantity_remaining=quantity,
        arrival_date=today,
        expiry_date=expiry,
        source="initial",
        order_record_id=None,
    )
    db.add(batch)


@router.post("", response_model=ProductRead, status_code=201)
def create_product(body: ProductCreate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    data = body.model_dump()
    today = _date.today()
    if data.get("current_stock") is not None:
        data["stock_as_of_date"] = today
    row = Product(business_id=biz.id, **data)
    db.add(row)
    db.flush()
    if row.current_stock is not None and row.current_stock > 0:
        _create_initial_batch(db, row, row.current_stock, today)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: int, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    return _get_or_404(db, product_id, biz.id)


@router.put("/{product_id}", response_model=ProductRead)
def update_product(product_id: int, body: ProductUpdate, db: Session = Depends(get_db), biz: Business = Depends(get_business)):
    row = _get_or_404(db, product_id, biz.id)
    today = _date.today()
    stock_being_set = (
        "current_stock" in body.model_fields_set and body.current_stock is not None
    )
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    # A PUT that (re)declares this product as a service must clear any stale
    # stock-only fields from before the conversion — exclude_none=True above
    # would otherwise skip them, since the schema validator already normalized
    # them to None (which looks indistinguishable from "not provided").
    if body.product_type == "service":
        row.lead_time_days = None
        row.current_stock = None
        row.storage_capacity = None
        row.shelf_life_days = None
    # Auto-advance the stock baseline date whenever current_stock is explicitly set
    if stock_being_set:
        row.stock_as_of_date = today
        # Create an 'initial' batch for the manual count if there are no batches yet
        existing_batches = (
            db.query(StockBatch)
            .filter_by(business_id=biz.id, product_id=product_id)
            .count()
        )
        if existing_batches == 0 and body.current_stock > 0:
            _create_initial_batch(db, row, body.current_stock, today)
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
    # Remove service consumable links involving this product (either side)
    db.query(ServiceConsumable).filter(
        (ServiceConsumable.service_product_id == product_id) |
        (ServiceConsumable.consumable_product_id == product_id)
    ).delete(synchronize_session=False)
    db.query(ServiceBookedCount).filter_by(product_id=product_id).delete(synchronize_session=False)
    db.delete(row)
    db.commit()


# ── service consumable management ─────────────────────────────────────────────

@router.get("/{product_id}/consumables", response_model=list[ServiceConsumableRead])
def list_consumables(
    product_id: int,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    svc = _get_or_404(db, product_id, biz.id)
    if getattr(svc, "product_type", "stocked") != "service":
        raise HTTPException(400, "This product is not a service")
    links = (
        db.query(ServiceConsumable)
        .filter_by(business_id=biz.id, service_product_id=product_id)
        .all()
    )
    result = []
    for lnk in links:
        consumable = db.get(Product, lnk.consumable_product_id)
        result.append(ServiceConsumableRead(
            id=lnk.id,
            service_product_id=lnk.service_product_id,
            consumable_product_id=lnk.consumable_product_id,
            qty_per_performance=lnk.qty_per_performance,
            consumable_name=consumable.name if consumable else "",
            consumable_unit=consumable.unit if consumable else "",
        ))
    return result


@router.post("/{product_id}/consumables", response_model=ServiceConsumableRead, status_code=201)
def add_consumable(
    product_id: int,
    body: ServiceConsumableCreate,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    svc = _get_or_404(db, product_id, biz.id)
    if getattr(svc, "product_type", "stocked") != "service":
        raise HTTPException(400, "This product is not a service")
    consumable = _get_or_404(db, body.consumable_product_id, biz.id)
    if getattr(consumable, "product_type", "stocked") != "stocked":
        raise HTTPException(400, "Consumable must be a stocked product")
    # Prevent duplicate link
    existing = (
        db.query(ServiceConsumable)
        .filter_by(
            business_id=biz.id,
            service_product_id=product_id,
            consumable_product_id=body.consumable_product_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(409, "This consumable is already linked to the service")
    lnk = ServiceConsumable(
        business_id=biz.id,
        service_product_id=product_id,
        consumable_product_id=body.consumable_product_id,
        qty_per_performance=body.qty_per_performance,
    )
    db.add(lnk)
    db.commit()
    db.refresh(lnk)
    return ServiceConsumableRead(
        id=lnk.id,
        service_product_id=lnk.service_product_id,
        consumable_product_id=lnk.consumable_product_id,
        qty_per_performance=lnk.qty_per_performance,
        consumable_name=consumable.name,
        consumable_unit=consumable.unit,
    )


@router.delete("/{product_id}/consumables/{consumable_link_id}", status_code=204)
def remove_consumable(
    product_id: int,
    consumable_link_id: int,
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    _get_or_404(db, product_id, biz.id)
    lnk = db.get(ServiceConsumable, consumable_link_id)
    if not lnk or lnk.business_id != biz.id or lnk.service_product_id != product_id:
        raise HTTPException(404, "Consumable link not found")
    db.delete(lnk)
    db.commit()

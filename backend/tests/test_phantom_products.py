"""Test that importing CSV data without product columns leaves products untouched.

Proves the phantom-product guard: a CSV with only date/customers columns
must never create SaleRecord entries, and existing product data is unchanged.
"""
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_business
from app.db import get_db
from app.main import app
from app.models import DayRecord, Product, SaleRecord


@pytest.fixture()
def imp_client(db, biz):
    """TestClient wired to the test DB, bypassing JWT."""
    def _db():
        yield db
    def _biz():
        return biz
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_business] = _biz
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


def test_import_without_products_creates_no_sale_records(imp_client, db, biz):
    """Importing date+customers data only must not invent any product-sale records."""
    # Create a product so one exists in the system
    product = Product(business_id=biz.id, name="Coffee", unit="cup", lead_time_days=1)
    db.add(product)
    db.commit()
    db.refresh(product)

    # Import a day record with no product data
    resp = imp_client.post("/day-records", json={"date": "2025-11-01", "customers": 42})
    assert resp.status_code == 201
    day_id = resp.json()["id"]

    # No sale records must have been created
    sale_records = db.query(SaleRecord).filter_by(day_record_id=day_id).all()
    assert sale_records == [], (
        f"Expected 0 SaleRecords but found {len(sale_records)}. "
        "Importing without product columns must not create phantom product sales."
    )

    # The product itself must be untouched
    p = db.get(Product, product.id)
    assert p is not None
    assert p.name == "Coffee"


def test_explicit_product_sale_creates_record(imp_client, db, biz):
    """Sanity-check: explicit product data DOES create a SaleRecord when wanted."""
    product = Product(business_id=biz.id, name="Tea", unit="cup", lead_time_days=1)
    db.add(product)
    db.commit()
    db.refresh(product)

    resp_day = imp_client.post("/day-records", json={"date": "2025-11-02", "customers": 10})
    assert resp_day.status_code == 201
    day_id = resp_day.json()["id"]

    resp_sale = imp_client.post("/sales", json={
        "day_record_id": day_id,
        "product_id": product.id,
        "units_sold": 5,
    })
    assert resp_sale.status_code == 201

    sale_records = db.query(SaleRecord).filter_by(day_record_id=day_id).all()
    assert len(sale_records) == 1
    assert sale_records[0].product_id == product.id
    assert sale_records[0].units_sold == 5

"""Deleting a business must not trip over a foreign key on Postgres.

The cascade emptied its tables in whatever order SQLAlchemy's mapper registry
happened to yield. SQLite does not enforce foreign keys unless asked, so every
test passed; Postgres does, and `DELETE /businesses/{id}` returned a 500 on any
location that had ever held a product — six tables point at `products`, and
`stock_batches` also points at `order_records`. It was found by driving the same
fixture through the live deployment and a local SQLite file and comparing
(`tests/deployment/probe_postgres_parity.py`).

Two tests, deliberately different in kind:

* the ORDER test reads the schema and fails if any table would be deleted after
  something it points at. It needs no database and covers a foreign key added
  next year — the failure mode that caused this.
* the ENFORCED test actually performs the deletion against SQLite with
  `PRAGMA foreign_keys=ON`, which makes SQLite behave the way Postgres always
  did. It reproduces the original 500 if the ordering regresses.
"""
from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.api.business_cascade import delete_business_data, deletion_order
from app.models import (
    Base,
    Business,
    DayRecord,
    OrderRecord,
    Period,
    Product,
    SaleEvent,
    SaleRecord,
    StockBatch,
)


def test_every_table_is_emptied_before_what_it_points_at():
    """Schema-derived: no hand-kept list to fall out of step with the tables."""
    order = [m.__tablename__ for m in deletion_order()]
    position = {name: i for i, name in enumerate(order)}

    for model in deletion_order():
        for column in model.__table__.columns:
            for fk in column.foreign_keys:
                target = fk.column.table.name
                if target == model.__tablename__ or target not in position:
                    continue        # self-reference, or a table outside the sweep
                assert position[model.__tablename__] < position[target], (
                    f"{model.__tablename__} points at {target} through "
                    f"{column.name}, but is deleted after it. Postgres refuses "
                    f"the transaction; SQLite silently allows it."
                )


@pytest.fixture()
def fk_session(tmp_path):
    """A SQLite session that enforces foreign keys, the way Postgres does."""
    engine = create_engine(f"sqlite:///{(tmp_path / 'fk.db').as_posix()}")

    @event.listens_for(engine, "connect")
    def _enforce(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def test_a_business_with_product_references_can_be_deleted(fk_session):
    """The original failure: every table below points at `products`."""
    db = fk_session
    biz = Business(name="Cascade order", settings={})
    db.add(biz)
    db.commit()

    product = Product(business_id=biz.id, name="Loaf", unit="loaf", lead_time_days=2)
    db.add(product)
    db.commit()

    day = DayRecord(business_id=biz.id, date=date(2026, 5, 4), customers=40)
    db.add(day)
    db.commit()

    order = OrderRecord(
        business_id=biz.id, product_id=product.id, quantity=20,
        ordered_date=date(2026, 5, 3),
        expected_arrival_date=date(2026, 5, 5),
    )
    db.add(order)
    db.commit()

    db.add_all([
        SaleRecord(day_record_id=day.id, product_id=product.id, units_sold=12),
        SaleEvent(business_id=biz.id, product_id=product.id,
                  timestamp=datetime(2026, 5, 4, 10, 0), quantity=1),
        Period(business_id=biz.id, start_date=date(2026, 5, 1),
               end_date=date(2026, 5, 2), type="ad", label="Flyer",
               target_product_id=product.id),
        StockBatch(business_id=biz.id, product_id=product.id,
                   quantity_initial=20, quantity_remaining=20,
                   arrival_date=date(2026, 5, 5), source="reorder",
                   order_record_id=order.id),
    ])
    db.commit()

    delete_business_data(db, biz.id)
    db.delete(biz)
    db.commit()                    # raises IntegrityError if the order is wrong

    assert db.query(Business).count() == 0
    for model in (Product, DayRecord, OrderRecord, SaleEvent, Period, StockBatch):
        assert db.query(model).count() == 0, f"{model.__tablename__} left behind"
    assert db.query(SaleRecord).count() == 0

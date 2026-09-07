"""Deleting a business, and everything that belongs to it.

The handler used to list the child tables by hand. Seven were missing —
`order_records`, `stock_batches`, `regular_daily_spends`, `service_consumables`,
`telegram_links`, `tuner_state` and `tuner_log` — so every location an owner
deleted left orphan rows behind for ever. Six of those tables did not exist when
the list was written; each was added later and nobody thought to come back.

So the list is not written by hand any more. It is DERIVED from the schema:
every mapped table with a foreign key to `businesses.id` is deleted, and the two
tables that reach a business only through a parent (`sale_records` via its day,
`regular_daily_spends` via its regular) are declared here explicitly. A table
added tomorrow is covered the moment it carries a `business_id`, and
`tests/test_business_delete_cascade.py` fails the build if one ever reaches a
business by a route this module does not know about.

SQLite does not enforce `ON DELETE CASCADE` unless `PRAGMA foreign_keys` is on,
and Postgres would only cascade where the constraint says so — which it mostly
does not here. Doing it in one place, explicitly, is what actually holds across
both.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import (
    Base,
    Business,
    DayRecord,
    Regular,
    RegularDailySpend,
    SaleRecord,
)

BUSINESS_FK = "businesses.id"

# Tables whose rows belong to a business only through a parent row. Each entry
# is (child model, child FK column, parent model) — the parent is itself deleted
# by the business_id sweep below, so these must go first.
INDIRECT: list[tuple[type, str, type]] = [
    (SaleRecord, "day_record_id", DayRecord),
    (RegularDailySpend, "regular_id", Regular),
]


def business_scoped_models() -> list[type]:
    """Every mapped class with a foreign key straight to `businesses.id`.

    Read from the SQLAlchemy metadata rather than a hand-kept list, so adding a
    table with a `business_id` is enough to have it cleaned up.
    """
    out = []
    for mapper in Base.registry.mappers:
        cls = mapper.class_
        if cls is Business:
            continue
        for col in mapper.local_table.columns:
            if any(fk.target_fullname == BUSINESS_FK for fk in col.foreign_keys):
                out.append(cls)
                break
    return out


def indirect_models() -> list[type]:
    return [child for child, _, _ in INDIRECT]


def delete_business_data(db: Session, business_id: int) -> None:
    """Remove every row belonging to `business_id`, leaving the business itself.

    Does not commit — the caller decides the transaction boundary, so a failure
    part-way through rolls the whole deletion back rather than leaving a
    half-erased business.
    """
    # 1. Children that reach the business through a parent, before the parent goes.
    for child, fk_name, parent in INDIRECT:
        parent_ids = [
            row.id for row in db.query(parent.id).filter_by(business_id=business_id).all()
        ]
        if parent_ids:
            db.query(child).filter(
                getattr(child, fk_name).in_(parent_ids)
            ).delete(synchronize_session=False)

    # 2. Everything keyed directly off the business.
    for model in business_scoped_models():
        db.query(model).filter_by(business_id=business_id).delete(synchronize_session=False)


def delete_business(db: Session, biz: Business) -> None:
    """Delete a business and everything belonging to it, in one transaction."""
    delete_business_data(db, biz.id)
    db.delete(biz)
    db.commit()

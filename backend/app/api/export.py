"""Download a copy of a business's data.

Nothing could get data out of Ope before this, although the privacy policy said
an owner "can export a copy of it at any time" and the spec makes free export a
point of trust: the moat is meant to be what Ope learns from the data, never the
data held hostage. Never gated by tier, and never capped to the free history
window — it is the owner's data, all of it.

Two forms:

* `/export/days.csv` — one row per logged day, in the same columns the CSV
  import reads (`date, customers, <one column per product>`), so the file opens
  in a spreadsheet and goes straight back into Ope or anywhere else.
* `/export/all.json` — every row belonging to the business, table by table. The
  table list is the one the delete cascade uses, derived from the schema, so a
  table added later is exported without anyone remembering to.
"""
from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import clock
from app.api.business_cascade import INDIRECT, business_scoped_models
from app.api.deps import get_business
from app.db import get_db
from app.models import Business, DayRecord, Product, SaleRecord

router = APIRouter(prefix="/export", tags=["Export"])

# Ope's own machinery, not the owner's data: the self-tuner's working state and
# its developer log.
_INTERNAL_TABLES = {"tuner_state", "tuner_log"}


def _filename(biz: Business, ext: str) -> str:
    stamp = clock.today_local(biz.settings).isoformat()
    return f"ope-{biz.id}-{stamp}.{ext}"


def _plain(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _rows(model, query) -> list[dict]:
    cols = [c.name for c in model.__table__.columns]
    return [{c: _plain(getattr(r, c)) for c in cols} for r in query.all()]


@router.get("/days.csv")
def export_days_csv(db: Session = Depends(get_db), biz: Business = Depends(get_business)) -> Response:
    products = db.query(Product).filter_by(business_id=biz.id).order_by(Product.id).all()
    days = db.query(DayRecord).filter_by(business_id=biz.id).order_by(DayRecord.date).all()
    units: dict[tuple[int, int], float] = {}
    if days:
        for s in db.query(SaleRecord).filter(SaleRecord.day_record_id.in_([d.id for d in days])).all():
            key = (s.day_record_id, s.product_id)
            units[key] = units.get(key, 0) + float(s.units_sold)

    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(["date", "customers", *[p.name for p in products]])
    for d in days:
        cells = []
        for p in products:
            v = units.get((d.id, p.id))
            cells.append("" if v is None else (int(v) if float(v).is_integer() else v))
        w.writerow([d.date.isoformat(), d.customers, *cells])

    # A byte-order mark, so Excel reads Hebrew and every other non-Latin product
    # name as UTF-8 rather than as mojibake. The import strips it again.
    body = "﻿" + out.getvalue()
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_filename(biz, "csv")}"'},
    )


@router.get("/all.json")
def export_all_json(db: Session = Depends(get_db), biz: Business = Depends(get_business)) -> Response:
    data: dict = {
        "exported_at": clock.now_naive_utc().isoformat() + "Z",
        "business": {"id": biz.id, "name": biz.name, "settings": biz.settings or {}},
        "tables": {},
    }
    for model in sorted(business_scoped_models(), key=lambda m: m.__tablename__):
        if model.__tablename__ in _INTERNAL_TABLES:
            continue
        data["tables"][model.__tablename__] = _rows(model, db.query(model).filter_by(business_id=biz.id))
    for child, fk_name, parent in INDIRECT:
        parent_ids = [r.id for r in db.query(parent.id).filter_by(business_id=biz.id).all()]
        q = db.query(child).filter(getattr(child, fk_name).in_(parent_ids)) if parent_ids else None
        data["tables"][child.__tablename__] = _rows(child, q) if q is not None else []

    return Response(
        content=json.dumps(data, ensure_ascii=False, indent=1).encode("utf-8"),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_filename(biz, "json")}"'},
    )

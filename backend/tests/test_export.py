"""An owner can take a full copy of their data out of Ope.

Nothing could, although the privacy policy promised it. The day file uses the
import's own columns, so it goes straight back in.
"""
from __future__ import annotations

import csv
import io
import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db import get_db
from app.main import app

USERS = {"who": "export-owner-a"}


@pytest.fixture()
def client(db):
    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USERS["who"]
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _stock(c, name: str, products: list[str], days: list[tuple[date, int, list[int]]]) -> int:
    biz = c.post("/businesses", json={"name": name}).json()["id"]
    c.headers["X-Business-Id"] = str(biz)
    pids = [c.post("/products", json={"name": p, "unit": "units", "lead_time_days": 2}).json()["id"] for p in products]
    for d, customers, units in days:
        r = c.post("/day-records", json={"date": d.isoformat(), "customers": customers})
        assert r.status_code == 201, r.text
        for pid, u in zip(pids, units):
            assert c.post("/sales", json={"day_record_id": r.json()["id"], "product_id": pid,
                                          "units_sold": u}).status_code in (200, 201)
    return biz


def test_the_day_file_has_the_import_columns_and_every_number(client):
    today = date.today()
    d1, d2 = today - timedelta(days=10), today - timedelta(days=9)
    _stock(client, "Corner Cafe", ["קפה", "Bagel, plain"], [(d1, 40, [55, 12]), (d2, 38, [50, 0])])

    r = client.get("/export/days.csv")
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    text = r.content.decode("utf-8")
    assert text.startswith("﻿"), "Excel needs the BOM to read Hebrew names"
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    assert rows[0] == ["date", "customers", "קפה", "Bagel, plain"]
    assert rows[1] == [d1.isoformat(), "40", "55", "12"]
    assert rows[2] == [d2.isoformat(), "38", "50", "0"]


def test_the_full_copy_holds_every_table_and_nothing_of_anyone_else(client):
    today = date.today()
    USERS["who"] = "export-owner-b"
    other = _stock(client, "Someone Else", ["Secret product"], [(today - timedelta(days=3), 999, [7])])
    client.headers.pop("X-Business-Id", None)

    USERS["who"] = "export-owner-a"
    mine = _stock(client, "Mine", ["Milk"], [(today - timedelta(days=4), 21, [9])])
    data = json.loads(client.get("/export/all.json").content)

    assert data["business"]["id"] == mine
    tables = data["tables"]
    for t in ("day_records", "products", "sale_records", "regulars", "periods"):
        assert t in tables, t
    assert [d["customers"] for d in tables["day_records"]] == [21]
    assert [s["units_sold"] for s in tables["sale_records"]] == [9]
    dumped = json.dumps(data, ensure_ascii=False)
    assert "Secret product" not in dumped and "999" not in dumped
    assert "tuner_log" not in tables, "Ope's own working notes are not the owner's data"

    # Naming another owner's business id falls back to the caller's own
    # business, as every endpoint does — it must never hand over theirs.
    client.headers["X-Business-Id"] = str(other)
    for path in ("/export/all.json", "/export/days.csv"):
        body = client.get(path).content.decode("utf-8")
        assert "Secret product" not in body and "999" not in body, path


def test_export_needs_a_signed_in_owner():
    app.dependency_overrides.clear()
    with TestClient(app) as c:
        assert c.get("/export/days.csv").status_code == 401

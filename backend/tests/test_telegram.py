"""
Tests for the Telegram linking & bot-service endpoints.

Covers:
  - POST /telegram/link-code  (generate / refresh a one-time code)
  - GET  /telegram/link        (status: unlinked / pending / linked)
  - POST /telegram/redeem      (bot redeems code → stores chat_id)
  - DELETE /telegram/link      (owner revokes the link)
  - GET  /bot/forecast         (service-authed, uses linked chat_id)
  - GET  /bot/ordering         (service-authed)
  - POST /bot/log-sale         (service-authed, creates SaleEvent)
  - Full end-to-end flow
"""
import os
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_business, get_tier
from app.engine.limits import Tier
from app.main import app
from app.models import Business, Product
from app.models.telegram_link import TelegramLink

BOT_KEY = os.environ["BOT_SERVICE_KEY"]   # set in conftest.py


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def biz(db):
    """A minimal test business."""
    b = Business(name="Test Bakery", user_id="user-abc-123")
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


@pytest.fixture()
def authed_client(client, biz):
    """TestClient with get_business overridden to return the test business."""
    def _override_biz():
        return biz
    app.dependency_overrides[get_business] = _override_biz
    app.dependency_overrides[get_tier] = lambda: Tier('free')
    yield client
    app.dependency_overrides.pop(get_business, None)


@pytest.fixture()
def product(db, biz):
    p = Product(business_id=biz.id, name="Croissant", unit="pcs", lead_time_days=2)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@pytest.fixture()
def linked_chat(db, biz):
    """A pre-existing TelegramLink that is already fully redeemed."""
    link = TelegramLink(business_id=biz.id, chat_id="chat-9999")
    db.add(link)
    db.commit()
    return "chat-9999"


# ── link-code generation ──────────────────────────────────────────────────────

def test_generate_link_code_returns_code(authed_client):
    r = authed_client.post("/telegram/link-code")
    assert r.status_code == 200
    body = r.json()
    assert "code" in body
    assert len(body["code"]) > 10
    assert body["expires_in_minutes"] == 60


def test_generate_link_code_twice_refreshes_code(authed_client):
    r1 = authed_client.post("/telegram/link-code")
    r2 = authed_client.post("/telegram/link-code")
    assert r1.status_code == 200
    assert r2.status_code == 200
    # The code must differ (it was rotated)
    assert r1.json()["code"] != r2.json()["code"]


def test_generate_link_code_stores_row(authed_client, db, biz):
    authed_client.post("/telegram/link-code")
    row = db.query(TelegramLink).filter_by(business_id=biz.id).first()
    assert row is not None
    assert row.link_code is not None
    assert row.chat_id is None


# ── link status ───────────────────────────────────────────────────────────────

def test_status_unlinked_no_row(authed_client):
    r = authed_client.get("/telegram/link")
    assert r.status_code == 200
    body = r.json()
    assert body["linked"] is False
    assert body["has_pending_code"] is False


def test_status_pending_code(authed_client):
    authed_client.post("/telegram/link-code")
    r = authed_client.get("/telegram/link")
    assert r.status_code == 200
    body = r.json()
    assert body["linked"] is False
    assert body["has_pending_code"] is True


def test_status_linked(authed_client, db, biz):
    link = TelegramLink(business_id=biz.id, chat_id="chat-123")
    db.add(link)
    db.commit()
    r = authed_client.get("/telegram/link")
    assert r.status_code == 200
    body = r.json()
    assert body["linked"] is True
    assert body["chat_id"] == "chat-123"


# ── redeem ────────────────────────────────────────────────────────────────────

def test_redeem_valid_code(authed_client, client, db, biz):
    r = authed_client.post("/telegram/link-code")
    code = r.json()["code"]

    r2 = client.post("/telegram/redeem", json={"code": code, "chat_id": "chat-42"})
    assert r2.status_code == 200
    body = r2.json()
    assert body["ok"] is True
    assert body["business_name"] == "Test Bakery"

    row = db.query(TelegramLink).filter_by(business_id=biz.id).first()
    db.refresh(row)
    assert row.chat_id == "chat-42"
    assert row.link_code is None


def test_redeem_invalid_code(client):
    r = client.post("/telegram/redeem", json={"code": "notacode", "chat_id": "chat-42"})
    assert r.status_code == 404


def test_redeem_expired_code(authed_client, client, db, biz):
    from datetime import datetime, timedelta, timezone
    authed_client.post("/telegram/link-code")
    row = db.query(TelegramLink).filter_by(business_id=biz.id).first()
    row.link_code_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
    db.commit()

    r = client.post("/telegram/redeem", json={"code": row.link_code, "chat_id": "chat-42"})
    assert r.status_code == 404


def test_redeem_updates_existing_link(authed_client, client, db, biz):
    # Business already linked to chat-111
    link = TelegramLink(business_id=biz.id, chat_id="chat-111")
    db.add(link)
    db.commit()

    # Owner generates a new code (e.g. to re-link to a different chat)
    r = authed_client.post("/telegram/link-code")
    code = r.json()["code"]

    # New chat redeems it
    r2 = client.post("/telegram/redeem", json={"code": code, "chat_id": "chat-222"})
    assert r2.status_code == 200

    db.refresh(link)
    assert link.chat_id == "chat-222"


# ── revoke ────────────────────────────────────────────────────────────────────

def test_revoke_linked(authed_client, db, biz):
    link = TelegramLink(business_id=biz.id, chat_id="chat-777")
    db.add(link)
    db.commit()

    r = authed_client.delete("/telegram/link")
    assert r.status_code == 204

    remaining = db.query(TelegramLink).filter_by(business_id=biz.id).first()
    assert remaining is None


def test_revoke_when_not_linked(authed_client):
    r = authed_client.delete("/telegram/link")
    assert r.status_code == 204   # idempotent


# ── full end-to-end flow ──────────────────────────────────────────────────────

def test_full_link_flow(authed_client, client, db, biz):
    # 1. Status: unlinked
    assert authed_client.get("/telegram/link").json()["linked"] is False

    # 2. Generate code
    code = authed_client.post("/telegram/link-code").json()["code"]

    # 3. Pending status
    status = authed_client.get("/telegram/link").json()
    assert status["linked"] is False
    assert status["has_pending_code"] is True

    # 4. Redeem
    client.post("/telegram/redeem", json={"code": code, "chat_id": "chat-99"})

    # 5. Linked status
    status = authed_client.get("/telegram/link").json()
    assert status["linked"] is True
    assert status["chat_id"] == "chat-99"

    # 6. Revoke
    authed_client.delete("/telegram/link")
    assert authed_client.get("/telegram/link").json()["linked"] is False


# ── bot service-key auth ──────────────────────────────────────────────────────

def test_bot_missing_key_rejected(client, linked_chat):
    r = client.get(f"/bot/forecast?chat_id={linked_chat}")
    assert r.status_code == 401


def test_bot_wrong_key_rejected(client, linked_chat):
    r = client.get(
        f"/bot/forecast?chat_id={linked_chat}",
        headers={"X-Bot-Service-Key": "wrong-key"},
    )
    assert r.status_code == 401


def test_bot_unknown_chat_id(client):
    r = client.get(
        "/bot/forecast?chat_id=nobody",
        headers={"X-Bot-Service-Key": BOT_KEY},
    )
    assert r.status_code == 404


# ── bot /forecast ─────────────────────────────────────────────────────────────

def test_bot_forecast_linked(client, linked_chat):
    r = client.get(
        f"/bot/forecast?chat_id={linked_chat}",
        headers={"X-Bot-Service-Key": BOT_KEY},
    )
    assert r.status_code == 200
    body = r.json()
    # No history → not_enough_data, but the endpoint still returns 200
    assert body["status"] in ("ok", "not_enough_data")


# ── bot /ordering ─────────────────────────────────────────────────────────────

def test_bot_ordering_linked(client, linked_chat):
    r = client.get(
        f"/bot/ordering?chat_id={linked_chat}",
        headers={"X-Bot-Service-Key": BOT_KEY},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("ok", "no_products", "not_enough_data")


# ── bot /log-sale ─────────────────────────────────────────────────────────────

def test_bot_log_sale_success(client, linked_chat, product):
    r = client.post(
        f"/bot/log-sale?chat_id={linked_chat}",
        headers={"X-Bot-Service-Key": BOT_KEY},
        json={"product_name": "Croissant", "quantity": 3},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["ok"] is True
    assert body["product"] == "Croissant"
    assert body["quantity"] == 3.0


def test_bot_log_sale_case_insensitive(client, linked_chat, product):
    r = client.post(
        f"/bot/log-sale?chat_id={linked_chat}",
        headers={"X-Bot-Service-Key": BOT_KEY},
        json={"product_name": "croissant", "quantity": 1},
    )
    assert r.status_code == 201


def test_bot_log_sale_prefix_match(client, linked_chat, product):
    r = client.post(
        f"/bot/log-sale?chat_id={linked_chat}",
        headers={"X-Bot-Service-Key": BOT_KEY},
        json={"product_name": "croiss", "quantity": 1},
    )
    assert r.status_code == 201


def test_bot_log_sale_unknown_product(client, linked_chat):
    r = client.post(
        f"/bot/log-sale?chat_id={linked_chat}",
        headers={"X-Bot-Service-Key": BOT_KEY},
        json={"product_name": "Unicorn Cake", "quantity": 1},
    )
    assert r.status_code == 404


def test_bot_log_sale_wrong_key(client, linked_chat, product):
    r = client.post(
        f"/bot/log-sale?chat_id={linked_chat}",
        headers={"X-Bot-Service-Key": "bad"},
        json={"product_name": "Croissant", "quantity": 1},
    )
    assert r.status_code == 401

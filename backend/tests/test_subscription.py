"""
Tests for the subscription / billing system.

Uses the same conftest.py fixtures as the other API tests:
  - `client`  — TestClient with get_db overridden
  - `db`      — raw SQLAlchemy session

The JWT auth dep (get_current_user) is overridden to return a fixed user_id
so we don't need real Supabase tokens.
"""
import os
import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient

# conftest sets SUPABASE_URL / DATABASE_URL before any import, so importing
# here is fine.
from app.main import app
from app.api.deps import get_current_user
from app.db import get_db
from app.models.subscription import Subscription, TRIAL_DAYS

TEST_USER = "test-user-sub-001"
ADMIN_KEY = "test-admin-key-sub"

# Force the ADMIN_KEY so require_admin_key recognises our test key.
# setdefault is insufficient if conftest already set it; overwrite directly.
os.environ["ADMIN_KEY"] = ADMIN_KEY


@pytest.fixture()
def auth_client(db):
    """TestClient with both get_db and get_current_user overridden."""
    def _override_db():
        yield db

    def _override_user():
        return TEST_USER

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


# ── 1. GET /subscription creates a trial for a new user ──────────────────────

def test_get_subscription_creates_trial(auth_client, db):
    resp = auth_client.get("/subscription")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["tier"] == "trial"
    assert data["subscription_status"] == "none"
    assert data["trial_days_remaining"] is not None
    assert data["trial_days_remaining"] > 0

    # Exactly one row in DB
    subs = db.query(Subscription).filter(Subscription.user_id == TEST_USER).all()
    assert len(subs) == 1


# ── 2. During trial, effective_tier is "premium" ─────────────────────────────

def test_trial_effective_tier_is_premium(auth_client, db):
    resp = auth_client.get("/subscription")
    assert resp.status_code == 200
    data = resp.json()
    assert data["effective_tier"] == "premium"


# ── 3. After trial_ends_at, effective_tier is "free" ─────────────────────────

def test_trial_expired_is_free(db, auth_client):
    # Create a subscription whose trial already ended
    now = datetime.now(timezone.utc)
    sub = Subscription(
        user_id=TEST_USER,
        tier="trial",
        trial_started_at=now - timedelta(days=40),
        trial_ends_at=now - timedelta(days=10),  # expired 10 days ago
        subscription_status="none",
    )
    db.add(sub)
    db.commit()

    resp = auth_client.get("/subscription")
    assert resp.status_code == 200
    data = resp.json()
    assert data["effective_tier"] == "free"
    assert data["trial_days_remaining"] == 0


# ── 4. POST /subscription/checkout returns a checkout_url ────────────────────

def test_checkout_returns_url(auth_client):
    body = {
        "plan": "monthly",
        "success_url": "https://example.com/success",
        "cancel_url": "https://example.com/cancel",
    }
    resp = auth_client.post("/subscription/checkout", json=body)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "checkout_url" in data
    assert "stub=1" in data["checkout_url"]
    assert "monthly" in data["checkout_url"]


# ── 5. GET /admin/subscriptions requires X-Admin-Key ─────────────────────────

def test_admin_subscriptions_requires_admin_key(auth_client):
    # Without the key → 403
    resp = auth_client.get("/admin/subscriptions")
    assert resp.status_code == 403

    # With the correct key → 200
    resp = auth_client.get(
        "/admin/subscriptions",
        headers={"X-Admin-Key": ADMIN_KEY},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "summary" in data
    assert "subscriptions" in data

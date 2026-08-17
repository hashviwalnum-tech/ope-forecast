"""
Free-tier limits: do they actually bind?

Spec §10 is explicit — "Enforce caps server-side (never only client). Tier flag +
limit checks read live tier."

FINDING F-018: they read a *cached* tier.  Creating a business writes
`settings["tier"] = "premium"` for the 30-day trial, and the only thing that ever
writes it back down is the client calling `GET /subscription`.  A client that
never calls it — or an API-only caller — keeps every premium limit forever.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api.deps import get_current_user
from app.db import get_db
from app.engine.limits import FREE_ADS_LIMIT, FREE_EVENTS_LIMIT
from app.main import app
from app.models.subscription import TRIAL_DAYS

USER = "tier-limit-user"


@pytest.fixture()
def sim_clock(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    yield
    clock.unfreeze()


@pytest.fixture()
def tier_client(db):
    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _new_account(c) -> int:
    return c.post("/businesses", json={"name": "Test Cafe"}).json()["id"]


# ── the trial must actually end ──────────────────────────────────────────────

def test_trial_grants_premium_while_it_lasts(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    r = tier_client.post("/businesses", json={"name": "Second Location"})
    assert r.status_code == 201, "a trial user should be able to add a location"


def test_expired_trial_loses_premium_without_the_client_asking(tier_client, sim_clock):
    """The core of F-018.

    Nothing here calls GET /subscription — exactly like a user who never opens
    the premium screen, or any API-only client.  The limit must still bind.
    """
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)

    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
                 + timedelta(days=TRIAL_DAYS + 1))

    r = tier_client.post("/businesses", json={"name": "Second Location"})
    assert r.status_code == 403, (
        "an expired trial must not still be able to create extra locations — "
        "the tier check has to read the live subscription, not a cached flag"
    )
    assert "premium" in r.json()["detail"].lower()


def test_expired_trial_cannot_copy_a_location(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    biz_id = _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))
    r = tier_client.post(f"/businesses/{biz_id}/copy", json={"name": "Copy"})
    assert r.status_code == 403


def test_expired_trial_reverts_the_reported_tier(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))
    assert tier_client.get("/businesses/me").json()["tier"] == "free"


# ── ad and event allowances ──────────────────────────────────────────────────

def _make_period(c, i: int, kind: str):
    return c.post("/periods", json={
        "start_date": f"2026-03-{(i % 28) + 1:02d}",
        "end_date": f"2026-03-{(i % 28) + 1:02d}",
        "type": kind,
        "label": f"{kind} number {i}",
    })


def test_free_ad_allowance_binds(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))   # trial over

    for i in range(FREE_ADS_LIMIT):
        assert _make_period(tier_client, i, "ad").status_code == 201, f"ad {i}"
    r = _make_period(tier_client, FREE_ADS_LIMIT, "ad")
    assert r.status_code in (403, 422), "the free ad allowance must bind"
    assert "premium" in r.json()["detail"].lower()


def test_free_event_allowance_binds(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))

    for i in range(FREE_EVENTS_LIMIT):
        assert _make_period(tier_client, i, "event").status_code == 201, f"event {i}"
    r = _make_period(tier_client, FREE_EVENTS_LIMIT, "event")
    assert r.status_code in (403, 422)


def test_events_and_ads_have_separate_allowances(tier_client, sim_clock):
    """Filling the ad allowance must not stop the owner tagging an event."""
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))
    for i in range(FREE_ADS_LIMIT):
        _make_period(tier_client, i, "ad")
    assert _make_period(tier_client, 90, "event").status_code == 201


# ── history cap ──────────────────────────────────────────────────────────────

def test_free_history_cap_binds(tier_client, sim_clock):
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 3, 1, 20, 0, tzinfo=timezone.utc))    # trial over

    ok = tier_client.post("/day-records", json={"date": "2025-06-01", "customers": 40})
    assert ok.status_code == 201, "a date inside the 1-year window is fine"

    too_old = tier_client.post("/day-records", json={"date": "2024-06-01", "customers": 40})
    assert too_old.status_code == 403
    assert "premium" in too_old.json()["detail"].lower()


# ── upgrading must take effect immediately ───────────────────────────────────

def test_admin_upgrade_lifts_the_location_limit_at_runtime(tier_client, sim_clock, monkeypatch):
    monkeypatch.setenv("ADMIN_KEY", "test-admin-key")
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
    _new_account(tier_client)
    clock.freeze(datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc))

    assert tier_client.post("/businesses", json={"name": "Nope"}).status_code == 403

    up = tier_client.patch("/businesses/me/tier", json={"tier": "premium"},
                           headers={"X-Admin-Key": "test-admin-key"})
    assert up.status_code == 200
    assert tier_client.post("/businesses", json={"name": "Second"}).status_code == 201


# ── the gate audit: every path that reads a tier must resolve it live ────────

def test_the_telegram_bot_does_not_serve_a_stale_tier(db, sim_clock, monkeypatch):
    """FOUND BY AUDIT: the bot loads its business directly from the link row,
    bypassing get_business and therefore the live-tier resolution. An expired
    trial kept premium history depth in its forecasts indefinitely — and because
    the bot never touches get_business, nothing on that path refreshed the flag
    either."""
    import os
    from app.api.bot import _business_for_chat
    from app.models import Business
    from app.models.telegram_link import TelegramLink

    os.environ.setdefault("BOT_SERVICE_KEY", "test-bot-key-abc123")
    clock.freeze(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))

    # A brand-new account: trial running, so premium.
    biz = Business(name="Bot Cafe", user_id=USER, settings={})
    db.add(biz)
    db.commit()
    db.refresh(biz)
    from app.models.subscription import Subscription
    db.add(Subscription(user_id=USER, tier="trial",
                        trial_started_at=clock.now_utc(),
                        trial_ends_at=clock.now_utc() + timedelta(days=TRIAL_DAYS)))
    settings = dict(biz.settings or {})
    settings["tier"] = "premium"          # the cached flag the trial wrote
    biz.settings = settings
    db.commit()

    assert _business_for_chat_tier(db, biz) == "premium", "in trial: premium"

    # Long after the trial ended, with nothing having called get_business.
    clock.freeze(datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc))
    assert _business_for_chat_tier(db, biz) == "free", (
        "an expired trial must not keep premium through the bot"
    )


def _business_for_chat_tier(db, biz):
    """Resolve a business the way the bot does, and report the tier it would use."""
    from app.api.bot import _business_for_chat
    from app.models.telegram_link import TelegramLink

    link = db.query(TelegramLink).filter_by(business_id=biz.id).first()
    if link is None:
        link = TelegramLink(business_id=biz.id, chat_id="chat-1")
        db.add(link)
        db.commit()
    return _business_for_chat("chat-1", db).tier


def test_no_new_code_path_reads_a_tier_off_a_directly_loaded_business():
    """Structural guard for the audit.

    Every gate reads `biz.tier`, which is only trustworthy once
    `sync_user_tier` has run for that user. Loading a Business directly with
    `db.get(Business, ...)` skips that, so any function doing BOTH must also
    call `sync_user_tier` — otherwise it is gating on a cached flag, which is
    exactly how the trial-to-free transition leaked, and how the Telegram bot
    kept serving premium history depth to expired trials.
    """
    import ast
    from pathlib import Path

    app_dir = Path(__file__).resolve().parents[1] / "app"

    def _calls_direct_business_load(node) -> bool:
        for n in ast.walk(node):
            if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                    and n.func.attr == "get" and n.args
                    and isinstance(n.args[0], ast.Name) and n.args[0].id == "Business"):
                return True
        return False

    def _reads_tier(node) -> bool:
        return any(isinstance(n, ast.Attribute) and n.attr == "tier" for n in ast.walk(node))

    def _syncs(node) -> bool:
        return any(isinstance(n, ast.Name) and n.id == "sync_user_tier" for n in ast.walk(node))

    offenders = []
    for path in app_dir.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if _calls_direct_business_load(fn) and _reads_tier(fn) and not _syncs(fn):
                offenders.append(f"{path.relative_to(app_dir.parent)}::{fn.name}")

    assert not offenders, (
        "these load a Business directly AND gate on its tier without resolving "
        f"the live tier first: {offenders}"
    )

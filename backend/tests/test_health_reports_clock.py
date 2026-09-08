"""
/health has to say whether the deployment's clock is real.

The guards in app/clock.py are pinned by tests/test_clock.py, but those prove
the *code* refuses a simulated clock — not that the process answering requests
on Render is refusing it. Nothing was observable from outside, so the only way
to check the rule held in production was to read the source and trust it.

/health now reports it, and these tests pin the reporting itself: a normal
process says "live", and a frozen one says "simulated". Without the second
test the field could quietly report "live" unconditionally and still pass.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.main import app

client = TestClient(app)


def test_health_reports_a_live_clock():
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["clock"] == "live"


def test_health_says_whether_errors_are_reported_anywhere():
    """A boolean, never the DSN itself — the DSN is a credential."""
    body = client.get("/health").json()
    assert isinstance(body["error_reporting"], bool)
    assert "SENTRY" not in json.dumps(body).upper()


def test_health_server_time_is_the_real_time():
    body = client.get("/health").json()
    reported = datetime.fromisoformat(body["server_time"])
    assert abs((datetime.now(timezone.utc) - reported).total_seconds()) < 60


def test_health_reports_a_simulated_clock_when_one_is_in_force(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    clock.freeze(datetime(2020, 5, 4, 12, 0, tzinfo=timezone.utc))
    try:
        assert client.get("/health").json()["clock"] == "simulated"
    finally:
        clock.unfreeze()

"""
Tests for app/clock.py — the injectable clock.

Two things matter here:

1. The override CANNOT be enabled by accident.  A simulated clock leaking into
   production would silently corrupt every "today", every day rollover and every
   retention window.
2. "Today" is the *business's* today, not the server's.  Both directions are
   pinned: a New York business (behind UTC) and an Israeli one (ahead of UTC).
"""
from __future__ import annotations

import os
from datetime import date, datetime, timezone

import pytest

from app import clock


# ── The production guard ─────────────────────────────────────────────────────

def test_clock_is_live_by_default():
    """With no flag set, the clock must be the real one."""
    assert not clock.is_frozen()
    delta = abs((clock.now_utc() - datetime.now(timezone.utc)).total_seconds())
    assert delta < 5


def test_freeze_refuses_without_the_test_flag(monkeypatch):
    monkeypatch.delenv("OPE_SIMULATED_CLOCK", raising=False)
    with pytest.raises(RuntimeError, match="test-only"):
        clock.freeze(datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert not clock.is_frozen()


def test_freeze_refuses_on_a_render_deployment(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.setenv("RENDER", "true")
    with pytest.raises(RuntimeError):
        clock.freeze(datetime(2026, 1, 1, tzinfo=timezone.utc))


def test_freeze_refuses_against_a_non_sqlite_database(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@db.supabase.co/postgres")
    with pytest.raises(RuntimeError):
        clock.freeze(datetime(2026, 1, 1, tzinfo=timezone.utc))


def test_simulated_flag_is_not_set_in_the_example_env():
    """.env.example must never hint that the override is a normal setting."""
    from pathlib import Path
    example = Path(__file__).resolve().parents[1] / ".env.example"
    assert "OPE_SIMULATED_CLOCK" not in example.read_text(encoding="utf-8")


# ── Freezing (only under the flag) ───────────────────────────────────────────

@pytest.fixture()
def sim_clock(monkeypatch):
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    yield
    clock.unfreeze()


def test_freeze_and_unfreeze(sim_clock):
    moment = datetime(2026, 3, 15, 14, 30, tzinfo=timezone.utc)
    clock.freeze(moment)
    assert clock.is_frozen()
    assert clock.now_utc() == moment
    assert clock.now_naive_utc() == datetime(2026, 3, 15, 14, 30)
    clock.unfreeze()
    assert not clock.is_frozen()


def test_frozen_time_is_ignored_if_the_flag_goes_away(sim_clock, monkeypatch):
    """Belt and braces: even a frozen value must not be served once the flag is off."""
    clock.freeze(datetime(2000, 1, 1, tzinfo=timezone.utc))
    monkeypatch.delenv("OPE_SIMULATED_CLOCK", raising=False)
    assert clock.now_utc().year >= 2025


# ── Business-local time ──────────────────────────────────────────────────────

NY = {"timezone": "America/New_York"}
IL = {"timezone": "Asia/Jerusalem"}


def test_today_is_the_businesss_today_not_the_servers_west_of_utc(sim_clock):
    """20:30 UTC on 1 July is still 16:30 on 1 July in New York — same date here,
    but 01:30 UTC on 2 July is 21:30 on 1 July in New York: a different date."""
    clock.freeze(datetime(2026, 7, 2, 1, 30, tzinfo=timezone.utc))
    assert clock.today_local(None) == date(2026, 7, 2)      # server/UTC view
    assert clock.today_local(NY) == date(2026, 7, 1)        # the shop's view
    assert clock.hour_local(NY) == 21


def test_today_is_the_businesss_today_not_the_servers_east_of_utc(sim_clock):
    """23:30 UTC on 1 July is already 02:30 on 2 July in Jerusalem."""
    clock.freeze(datetime(2026, 7, 1, 23, 30, tzinfo=timezone.utc))
    assert clock.today_local(None) == date(2026, 7, 1)
    assert clock.today_local(IL) == date(2026, 7, 2)
    assert clock.hour_local(IL) == 2


def test_daylight_saving_transition_is_handled(sim_clock):
    """New York is UTC−4 in summer and UTC−5 in winter; the offset must follow."""
    clock.freeze(datetime(2026, 7, 1, 16, 0, tzinfo=timezone.utc))
    assert clock.hour_local(NY) == 12          # EDT, UTC−4
    clock.freeze(datetime(2026, 1, 1, 16, 0, tzinfo=timezone.utc))
    assert clock.hour_local(NY) == 11          # EST, UTC−5


def test_unknown_timezone_never_crashes(sim_clock):
    clock.freeze(datetime(2026, 7, 1, 16, 0, tzinfo=timezone.utc))
    assert clock.today_local({"timezone": "Not/AReal_Zone"}) == date(2026, 7, 1)


def test_missing_timezone_setting_falls_back_to_utc(sim_clock):
    clock.freeze(datetime(2026, 7, 1, 16, 0, tzinfo=timezone.utc))
    assert clock.today_local({}) == date(2026, 7, 1)
    assert clock.hour_local({}) == 16

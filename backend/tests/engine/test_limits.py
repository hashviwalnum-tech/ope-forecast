"""
Known-answer tests for engine/limits.py — tier gating logic.
"""
from datetime import date, timedelta
import pytest
from app.engine.limits import (
    FREE_HISTORY_DAYS,
    FREE_PERIODS_LIMIT,
    history_cutoff,
    check_history,
    check_periods,
)

TODAY = date(2026, 5, 31)


# ── history_cutoff ─────────────────────────────────────────────────────────────

def test_history_cutoff_free_is_365_days_ago():
    cutoff = history_cutoff("free", TODAY)
    assert cutoff == TODAY - timedelta(days=FREE_HISTORY_DAYS)


def test_history_cutoff_premium_is_none():
    assert history_cutoff("premium", TODAY) is None


# ── check_history ──────────────────────────────────────────────────────────────

def test_check_history_premium_allows_any_date():
    very_old = date(2000, 1, 1)
    check_history("premium", very_old, TODAY)  # no exception


def test_check_history_free_recent_date_passes():
    recent = TODAY - timedelta(days=30)
    check_history("free", recent, TODAY)  # no exception


def test_check_history_free_exactly_at_cutoff_passes():
    # The boundary date itself is inclusive
    cutoff = TODAY - timedelta(days=FREE_HISTORY_DAYS)
    check_history("free", cutoff, TODAY)  # no exception


def test_check_history_free_one_day_before_cutoff_fails():
    one_beyond = TODAY - timedelta(days=FREE_HISTORY_DAYS + 1)
    with pytest.raises(ValueError, match="free plan"):
        check_history("free", one_beyond, TODAY)


def test_check_history_free_very_old_date_fails():
    old = date(2020, 1, 1)
    with pytest.raises(ValueError):
        check_history("free", old, TODAY)


def test_check_history_error_message_contains_cutoff_date():
    one_beyond = TODAY - timedelta(days=FREE_HISTORY_DAYS + 1)
    with pytest.raises(ValueError) as exc_info:
        check_history("free", one_beyond, TODAY)
    msg = str(exc_info.value)
    assert "premium" in msg.lower()
    assert "1 year" in msg


# ── check_periods ──────────────────────────────────────────────────────────────

def test_check_periods_premium_allows_any_count():
    check_periods("premium", 0)
    check_periods("premium", 100)  # no exception


def test_check_periods_free_zero_passes():
    check_periods("free", 0)  # no exception


def test_check_periods_free_one_under_limit_passes():
    check_periods("free", FREE_PERIODS_LIMIT - 1)  # no exception


def test_check_periods_free_at_limit_fails():
    with pytest.raises(ValueError, match="free plan"):
        check_periods("free", FREE_PERIODS_LIMIT)


def test_check_periods_free_over_limit_fails():
    with pytest.raises(ValueError):
        check_periods("free", FREE_PERIODS_LIMIT + 5)


def test_check_periods_error_mentions_premium():
    with pytest.raises(ValueError) as exc_info:
        check_periods("free", FREE_PERIODS_LIMIT)
    assert "premium" in str(exc_info.value).lower()


def test_free_periods_limit_constant_is_2():
    """Spec says 'e.g. 2' — lock it in so changes are deliberate."""
    assert FREE_PERIODS_LIMIT == 2


def test_free_history_days_constant_in_range():
    """Spec says '6 months to 1 year' — 365 is within that range."""
    assert 180 <= FREE_HISTORY_DAYS <= 365

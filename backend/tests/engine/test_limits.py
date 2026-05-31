"""
Known-answer tests for engine/limits.py — tier gating logic.
"""
from datetime import date, timedelta
import pytest
from app.engine.limits import (
    FREE_HISTORY_DAYS,
    FREE_PERIODS_LIMIT,
    check_entry_timing,
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


# ── check_entry_timing ────────────────────────────────────────────────────────

TODAY = date(2026, 6, 1)
OPEN = 9    # 9 am
CLOSE = 18  # 6 pm


def test_past_date_always_allowed():
    # Any day before today is fine regardless of the current hour or hours config.
    yesterday = TODAY - timedelta(days=1)
    check_entry_timing(yesterday, TODAY, 14, OPEN, CLOSE)          # during hours
    check_entry_timing(yesterday, TODAY, 7, OPEN, CLOSE)           # before opening
    check_entry_timing(yesterday, TODAY, 22, OPEN, CLOSE)          # after closing


def test_past_date_no_hours_configured():
    yesterday = TODAY - timedelta(days=1)
    check_entry_timing(yesterday, TODAY, 14, None, None)


def test_today_no_hours_configured_always_allowed():
    # When opening/closing hours are not set, today is never blocked.
    check_entry_timing(TODAY, TODAY, 14, None, None)
    check_entry_timing(TODAY, TODAY, 14, None, CLOSE)
    check_entry_timing(TODAY, TODAY, 14, OPEN, None)


def test_today_after_closing_allowed():
    # At or after closing_hour — day is finished, allow.
    check_entry_timing(TODAY, TODAY, CLOSE, OPEN, CLOSE)
    check_entry_timing(TODAY, TODAY, CLOSE + 1, OPEN, CLOSE)
    check_entry_timing(TODAY, TODAY, 23, OPEN, CLOSE)


def test_today_during_open_hours_blocked():
    # During opening hours → business still open → block.
    with pytest.raises(ValueError, match="still open"):
        check_entry_timing(TODAY, TODAY, OPEN, OPEN, CLOSE)       # exactly at open
    with pytest.raises(ValueError, match="still open"):
        check_entry_timing(TODAY, TODAY, OPEN + 1, OPEN, CLOSE)   # mid-day
    with pytest.raises(ValueError, match="still open"):
        check_entry_timing(TODAY, TODAY, CLOSE - 1, OPEN, CLOSE)  # one hour before close


def test_today_before_opening_hour_blocked():
    # Before opening_hour → day hasn't started → block.
    with pytest.raises(ValueError, match="hasn't started"):
        check_entry_timing(TODAY, TODAY, 0, OPEN, CLOSE)
    with pytest.raises(ValueError, match="hasn't started"):
        check_entry_timing(TODAY, TODAY, OPEN - 1, OPEN, CLOSE)


def test_blocked_message_contains_closing_hour():
    # The error message names the closing time so the owner knows when to return.
    with pytest.raises(ValueError) as exc:
        check_entry_timing(TODAY, TODAY, OPEN + 2, OPEN, CLOSE)
    assert "6 pm" in str(exc.value)


def test_blocked_before_open_message_contains_opening_hour():
    with pytest.raises(ValueError) as exc:
        check_entry_timing(TODAY, TODAY, 7, OPEN, CLOSE)
    assert "9 am" in str(exc.value)


def test_midnight_closing_hour_blocks_all_day():
    # closing_hour=24 means "closes at midnight" — any hour during the day is blocked.
    with pytest.raises(ValueError):
        check_entry_timing(TODAY, TODAY, 23, 0, 24)


def test_same_open_and_close_hour_blocked_during_that_hour():
    # Degenerate but valid: opening=closing means the "open window" is zero-width.
    # current_hour < opening_hour → "not started" block
    with pytest.raises(ValueError, match="hasn't started"):
        check_entry_timing(TODAY, TODAY, 8, 9, 9)

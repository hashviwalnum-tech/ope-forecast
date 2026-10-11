"""Known-answer tests for engine.offline_taps.resolve_tap_time."""
from datetime import datetime, timedelta

import pytest

from app.engine.limits import RuleError
from app.engine.offline_taps import resolve_tap_time

NOW = datetime(2026, 10, 11, 12, 0, 0)


def test_no_tap_time_means_now():
    assert resolve_tap_time(NOW, None, None) == NOW


def test_a_queued_tap_keeps_the_time_it_was_made():
    """Tapped at 10:05, sent at noon by a phone whose clock is right."""
    tapped = datetime(2026, 10, 11, 10, 5, 0, 123456)
    got = resolve_tap_time(NOW, tapped, NOW)
    assert got == datetime(2026, 10, 11, 10, 5, 0, 123000)   # kept, to the millisecond


def test_small_clock_error_is_left_alone():
    """90 s of drift is under the trust threshold: the phone's time stands."""
    tapped = datetime(2026, 10, 11, 10, 0, 0)
    got = resolve_tap_time(NOW, tapped, NOW - timedelta(seconds=90))
    assert got == tapped


def test_a_phone_an_hour_slow_is_corrected():
    """Phone says it is 11:00 when it is noon: the tap at phone-10:00 was 11:00."""
    tapped = datetime(2026, 10, 11, 10, 0, 0)
    got = resolve_tap_time(NOW, tapped, NOW - timedelta(hours=1))
    assert got == datetime(2026, 10, 11, 11, 0, 0)


def test_a_re_send_seconds_later_gets_the_same_time():
    """What lets the server spot a repeat: the correction does not move when the
    same tap is sent again a few seconds on (an hour-slow phone, both times)."""
    tapped = datetime(2026, 10, 11, 10, 0, 0, 500000)
    first = resolve_tap_time(NOW, tapped, NOW - timedelta(hours=1))
    later = NOW + timedelta(seconds=20)
    second = resolve_tap_time(later, tapped, later - timedelta(hours=1, seconds=-3))
    assert first == second


def test_never_in_the_future():
    tapped = NOW + timedelta(seconds=30)        # phone 30 s fast, under the threshold
    assert resolve_tap_time(NOW, tapped, NOW) == NOW


def test_a_tap_a_week_old_is_kept():
    tapped = NOW - timedelta(days=7)
    assert resolve_tap_time(NOW, tapped, NOW) == tapped


def test_a_tap_over_thirty_days_old_is_refused_with_a_code():
    tapped = NOW - timedelta(days=31)
    with pytest.raises(RuleError) as e:
        resolve_tap_time(NOW, tapped, NOW)
    assert e.value.code == "tap_too_old"
    assert e.value.params == {"date": "2026-09-10"}

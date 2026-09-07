"""Known-answer tests for working out a business's timezone.

The point of most of these is the REFUSAL. A wrong zone is worse than no zone:
absent is visibly unset and the app can ask, while wrong quietly files a day's
takings under the wrong date. So the cases that must return None are tested at
least as hard as the ones that must return an answer.
"""
import pytest

from app.engine.timezone_inference import (
    MIN_ACTIVITY_EVENTS,
    TimezoneGuess,
    infer_from_activity,
    infer_timezone,
    zones_for_currency,
)


def busy_at(utc_hours: list[int], per_hour: int = 10) -> list[int]:
    """A plausible run of sale times, `per_hour` taps in each listed UTC hour."""
    return [h for h in utc_hours for _ in range(per_hour)]


# ── the currency signal ──────────────────────────────────────────────────────

def test_a_single_country_currency_settles_it_on_its_own():
    g = infer_timezone("ILS", [], None, None)
    assert g.zone == "Asia/Jerusalem"
    assert g.source == "currency"
    assert g.confidence == 1.0


def test_currency_wins_without_needing_any_activity():
    """A business that logs daily totals only still gets an answer."""
    for code, zone in [("JPY", "Asia/Tokyo"), ("GBP", "Europe/London"),
                       ("TRY", "Europe/Istanbul"), ("BRL", "America/Sao_Paulo")]:
        assert infer_timezone(code, [], None, None).zone == zone


def test_the_euro_is_deliberately_not_in_the_table():
    """Twenty countries, four zones — it would be a guess dressed as a fact."""
    assert zones_for_currency("EUR") == ()
    assert infer_timezone("EUR", [], None, None).zone is None


def test_an_unknown_currency_contributes_nothing_rather_than_erroring():
    assert zones_for_currency("XYZ") == ()
    assert zones_for_currency(None) == ()


# ── the activity signal ──────────────────────────────────────────────────────

def test_activity_finds_new_york_for_a_nine_to_five_shop():
    """Open 09:00–17:00 local, busy 14:00–21:00 UTC → five hours behind."""
    g = infer_from_activity(busy_at([14, 15, 16, 17, 18, 19, 20, 21]), 9, 17)
    assert g.zone == "America/New_York"
    assert g.source == "activity"


def test_activity_finds_jerusalem_for_the_same_shop_shifted_east():
    """Open 09:00–17:00 local, busy 07:00–14:00 UTC → two hours ahead.

    Eight hours of activity, not seven: with seven, +2 and +3 both place every
    tap inside the window and the two are genuinely indistinguishable. The
    engine refuses that tie, correctly — so the test has to give it data that
    can actually be decided.
    """
    g = infer_from_activity(busy_at([7, 8, 9, 10, 11, 12, 13, 14]), 9, 17)
    assert g.zone in ("Europe/Athens", "Asia/Jerusalem", "Europe/Paris")
    # What matters is the OFFSET it settled on, not which of the equal-offset
    # cities won the tie — they keep the same wall clock.
    from app.engine.timezone_inference import _offset_hours
    assert _offset_hours(g.zone) == pytest.approx(2.0)


def test_activity_handles_a_late_night_business_whose_hours_wrap_midnight():
    """Open 20:00–02:00 local, busy 20:00–01:00 UTC → already at UTC."""
    g = infer_from_activity(busy_at([20, 21, 22, 23, 0, 1]), 20, 2)
    from app.engine.timezone_inference import _offset_hours
    assert g.zone is not None
    assert _offset_hours(g.zone) == pytest.approx(0.0)


def test_activity_refuses_without_opening_hours():
    g = infer_from_activity(busy_at([14, 15, 16]), None, None)
    assert g.zone is None
    assert "opening hours" in g.reason


def test_activity_refuses_on_too_few_events():
    g = infer_from_activity([14] * (MIN_ACTIVITY_EVENTS - 1), 9, 17)
    assert g.zone is None
    assert "needs" in g.reason


def test_activity_refuses_when_nothing_fits():
    """Taps spread evenly round the clock explain nothing anywhere."""
    g = infer_from_activity(busy_at(list(range(24)), per_hour=3), 9, 17)
    assert g.zone is None
    assert "no zone explains" in g.reason


def test_activity_refuses_when_two_zones_are_too_close_to_call():
    """One hour of activity fits several neighbouring offsets equally well."""
    g = infer_from_activity(busy_at([12], per_hour=40), 9, 17)
    assert g.zone is None
    assert "too close to call" in g.reason


# ── the two together ─────────────────────────────────────────────────────────

def test_a_wide_currency_is_narrowed_by_activity():
    """USD spans six zones; the taps say which one."""
    g = infer_timezone("USD", busy_at([14, 15, 16, 17, 18, 19, 20, 21]), 9, 17)
    assert g.zone == "America/New_York"
    assert g.source == "currency+activity"
    assert "USD narrows it to 6 zones" in g.reason


def test_the_same_currency_lands_somewhere_else_on_different_activity():
    """Busy 17:00–00:00 UTC on a 09:00–17:00 day is the west coast."""
    g = infer_timezone("USD", busy_at([17, 18, 19, 20, 21, 22, 23, 0]), 9, 17)
    assert g.zone == "America/Los_Angeles"


def test_a_wide_currency_with_no_usable_activity_refuses():
    g = infer_timezone("USD", [], None, None)
    assert g.zone is None
    assert g.source == "unknown"
    assert "spans 6 zones" in g.reason


def test_activity_alone_answers_when_the_currency_says_nothing():
    g = infer_timezone("EUR", busy_at([7, 8, 9, 10, 11, 12, 13, 14]), 9, 17)
    assert g.zone is not None
    assert g.source == "activity"


def test_a_business_with_nothing_to_go_on_gets_no_zone_and_a_reason():
    """The case the backfill must report rather than paper over."""
    g = infer_timezone(None, [], None, None)
    assert g.zone is None
    assert g.source == "unknown"
    assert g.reason
    assert isinstance(g, TimezoneGuess)


def test_every_zone_in_the_tables_is_a_real_resolvable_zone():
    """A typo here would be stored and then break clock.now_local for real."""
    from zoneinfo import ZoneInfo
    from app.engine.timezone_inference import CURRENCY_ZONES, ZONES_BY_OFFSET
    for zones in CURRENCY_ZONES.values():
        for z in zones:
            ZoneInfo(z)          # raises if unknown
    for z in ZONES_BY_OFFSET:
        ZoneInfo(z)


def test_the_offset_ladder_covers_each_hour_once():
    """Two zones on the same offset would just split the vote between them."""
    from app.engine.timezone_inference import ZONES_BY_OFFSET, _offset_hours
    offsets = [_offset_hours(z) for z in ZONES_BY_OFFSET]
    assert len(offsets) == len(set(offsets)), (
        f"duplicate offsets in the ladder: {sorted(offsets)}"
    )

"""The one-time backfill that gives existing businesses a timezone.

The inference itself is tested against known answers in
`tests/engine/test_timezone_inference.py`. These tests are about the behaviour
around it: that it fills what it can, leaves alone what it cannot, never
overwrites a zone the owner already chose, and can be run twice.
"""
from datetime import date, datetime

import pytest

from app.api.timezone_backfill import (
    UNRESOLVED_KEY,
    backfill_timezones,
    guess_for_business,
)
from app.models import Business, SaleEvent


def _biz(db, **settings) -> Business:
    b = Business(name="Test", user_id="u1", settings=dict(settings))
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


def _taps(db, biz: Business, utc_hours: list[int], per_hour: int = 10) -> None:
    """Sale events at the given UTC hours — that is how they are stored."""
    day = date(2026, 1, 15)
    db.add_all([
        SaleEvent(
            business_id=biz.id,
            product_id=None,
            timestamp=datetime(day.year, day.month, day.day, h, 30),
            quantity=1,
        )
        for h in utc_hours for _ in range(per_hour)
    ])
    db.commit()


# ── what it fills ────────────────────────────────────────────────────────────

def test_a_business_with_a_single_country_currency_is_filled_from_that_alone(db):
    biz = _biz(db, currency="ILS")
    counts = backfill_timezones(db)
    db.refresh(biz)

    assert biz.settings["timezone"] == "Asia/Jerusalem"
    assert counts == {"already_set": 0, "filled": 1, "unresolved": 0}


def test_a_business_with_no_taps_at_all_is_still_filled_from_its_currency(db):
    """Most owners log daily totals; they must not be left out."""
    biz = _biz(db, currency="JPY")
    backfill_timezones(db)
    db.refresh(biz)
    assert biz.settings["timezone"] == "Asia/Tokyo"


def test_a_wide_currency_is_narrowed_by_the_businesss_own_trading_hours(db):
    biz = _biz(db, currency="USD", opening_hour=9, closing_hour=17)
    _taps(db, biz, [14, 15, 16, 17, 18, 19, 20, 21])

    backfill_timezones(db)
    db.refresh(biz)
    assert biz.settings["timezone"] == "America/New_York"


def test_it_records_how_it_arrived_at_the_value(db):
    """An owner who finds a surprising zone deserves better than 'it appeared'."""
    biz = _biz(db, currency="ILS")
    backfill_timezones(db)
    db.refresh(biz)

    note = biz.settings[UNRESOLVED_KEY]
    assert note["source"] == "currency"
    assert "ILS" in note["reason"]


# ── what it refuses ──────────────────────────────────────────────────────────

def test_a_business_it_cannot_work_out_is_left_with_no_timezone(db):
    """The case the user asked about: nothing to go on.

    No currency, no opening hours, no taps. It must stay UNSET — not be given a
    plausible-looking zone, and not be given UTC, which would look chosen.
    """
    biz = _biz(db)
    counts = backfill_timezones(db)
    db.refresh(biz)

    assert "timezone" not in biz.settings
    assert counts["unresolved"] == 1
    assert counts["filled"] == 0

    # ...and the reason is available rather than lost.
    assert guess_for_business(db, biz).reason


def test_the_euro_alone_is_not_enough_to_decide(db):
    biz = _biz(db, currency="EUR")
    backfill_timezones(db)
    db.refresh(biz)
    assert "timezone" not in biz.settings


def test_a_wide_currency_with_no_activity_is_left_unset(db):
    biz = _biz(db, currency="USD")
    backfill_timezones(db)
    db.refresh(biz)
    assert "timezone" not in biz.settings


def test_taps_scattered_round_the_clock_decide_nothing(db):
    biz = _biz(db, opening_hour=9, closing_hour=17)
    _taps(db, biz, list(range(24)), per_hour=3)
    backfill_timezones(db)
    db.refresh(biz)
    assert "timezone" not in biz.settings


# ── what it must never touch ─────────────────────────────────────────────────

def test_a_timezone_the_owner_already_chose_is_never_overwritten(db):
    """Even when the inference would have said something different."""
    biz = _biz(db, timezone="Europe/London", currency="ILS")
    counts = backfill_timezones(db)
    db.refresh(biz)

    assert biz.settings["timezone"] == "Europe/London"
    assert counts == {"already_set": 1, "filled": 0, "unresolved": 0}


def test_an_empty_string_timezone_counts_as_unset(db):
    """A blank is not a choice — it is the absence of one."""
    biz = _biz(db, timezone="   ", currency="ILS")
    backfill_timezones(db)
    db.refresh(biz)
    assert biz.settings["timezone"] == "Asia/Jerusalem"


def test_other_settings_survive_the_backfill(db):
    biz = _biz(db, currency="ILS", opening_hour=8, closing_hour=20,
               opening_days=[0, 1, 2, 3, 4], onboarding_done=True)
    backfill_timezones(db)
    db.refresh(biz)

    assert biz.settings["opening_hour"] == 8
    assert biz.settings["opening_days"] == [0, 1, 2, 3, 4]
    assert biz.settings["onboarding_done"] is True
    assert biz.settings["currency"] == "ILS"


# ── running it more than once ────────────────────────────────────────────────

def test_running_it_twice_changes_nothing_the_second_time(db):
    biz = _biz(db, currency="ILS")
    first = backfill_timezones(db)
    second = backfill_timezones(db)
    db.refresh(biz)

    assert first["filled"] == 1
    assert second == {"already_set": 1, "filled": 0, "unresolved": 0}
    assert biz.settings["timezone"] == "Asia/Jerusalem"


def test_an_unresolved_business_is_reconsidered_on_the_next_run(db):
    """It may have gathered enough activity since to be answerable."""
    biz = _biz(db, currency="USD", opening_hour=9, closing_hour=17)
    assert backfill_timezones(db)["unresolved"] == 1

    _taps(db, biz, [14, 15, 16, 17, 18, 19, 20, 21])
    assert backfill_timezones(db)["filled"] == 1
    db.refresh(biz)
    assert biz.settings["timezone"] == "America/New_York"


def test_several_businesses_are_handled_independently(db):
    a = _biz(db, currency="ILS")
    b = _biz(db, currency="EUR")
    c = _biz(db, timezone="Asia/Tokyo")

    counts = backfill_timezones(db)
    for x in (a, b, c):
        db.refresh(x)

    assert a.settings["timezone"] == "Asia/Jerusalem"
    assert "timezone" not in b.settings
    assert c.settings["timezone"] == "Asia/Tokyo"
    assert counts == {"already_set": 1, "filled": 1, "unresolved": 1}


def test_the_startup_hook_never_raises(db, monkeypatch):
    """A failing backfill must not stop the API booting."""
    from app.api import timezone_backfill

    monkeypatch.setattr(
        timezone_backfill, "backfill_timezones",
        lambda _db: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    from app.db import engine
    timezone_backfill.run_on_startup(engine)      # must not raise

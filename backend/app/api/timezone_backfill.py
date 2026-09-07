"""One-time backfill: give existing businesses the timezone they never got.

The field arrived after these businesses were created, so their settings have no
`timezone` and `clock.today_local` falls back to UTC for them — an owner east of
London has their evening filed under tomorrow, one west of it has their late
night filed under yesterday, and the hourly and peak-hours views are shifted for
both. Nothing in the app told them, and the only cure was opening Settings and
pressing Save, which no one had a reason to do.

Runs once at startup, alongside the other migrations. It is idempotent: a
business that already has a zone is never touched, and a business it could not
work out is left alone and re-examined next boot, when it may have accumulated
enough activity to be answerable.

WHAT IT WILL NOT DO
-------------------
It will not guess. `engine/timezone_inference` returns nothing unless the
currency settles it or the business's own trading hours do, and this stores
nothing when it returns nothing. A wrong zone is worse than an absent one:
absent is visibly unset, and the app can ask; wrong is silent and misfiles a
day's takings. Businesses it cannot answer keep `timezone` absent and are
counted in the log, and the web app now asks them directly (see the settings
prompt driven by BusinessTime's `isConfigured`).
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.engine.timezone_inference import TimezoneGuess, infer_timezone
from app.models import Business, SaleEvent

_log = logging.getLogger(__name__)

# Marks a business we have already looked at and could not answer. Kept so the
# log can tell "never examined" from "examined, unanswerable" — and so the
# reason is visible to whoever is asked about it later.
UNRESOLVED_KEY = "timezone_backfill"


def guess_for_business(db: Session, biz: Business) -> TimezoneGuess:
    """Work out one business's zone from its currency and its trading hours."""
    settings = biz.settings or {}
    rows = (
        db.query(SaleEvent.timestamp)
        .filter(SaleEvent.business_id == biz.id)
        .limit(2000)          # plenty to read a pattern from; bounded for big accounts
        .all()
    )
    utc_hours = [r[0].hour for r in rows if r[0] is not None]
    return infer_timezone(
        currency=settings.get("currency"),
        utc_hours=utc_hours,
        opening_hour=settings.get("opening_hour"),
        closing_hour=settings.get("closing_hour"),
    )


def backfill_timezones(db: Session) -> dict[str, int]:
    """Set a timezone on every business that has none and can be worked out.

    Returns counts for the log: how many were already set, how many were filled
    in, and how many could not be determined.
    """
    counts = {"already_set": 0, "filled": 0, "unresolved": 0}

    for biz in db.query(Business).all():
        settings = biz.settings or {}
        existing = settings.get("timezone")
        if isinstance(existing, str) and existing.strip():
            counts["already_set"] += 1
            continue

        guess = guess_for_business(db, biz)
        if guess.zone:
            biz.settings = {**settings, "timezone": guess.zone}
            # Leave a trace of how the value was arrived at — an owner who finds
            # a surprising zone deserves an answer better than "it appeared".
            biz.settings[UNRESOLVED_KEY] = {
                "source": guess.source,
                "reason": guess.reason,
            }
            flag_modified(biz, "settings")
            counts["filled"] += 1
            _log.info(
                "timezone backfill: business %s -> %s (%s: %s)",
                biz.id, guess.zone, guess.source, guess.reason,
            )
        else:
            counts["unresolved"] += 1
            _log.info(
                "timezone backfill: business %s left unset (%s)", biz.id, guess.reason
            )

    if counts["filled"]:
        db.commit()
    return counts


def run_on_startup(engine) -> None:
    """Called from the app lifespan. Never allowed to stop the app booting.

    A backfill that crashed on some unexpected row would take the whole API down
    with it, which is a far worse outcome than a business keeping a UTC fallback
    for another day.
    """
    try:
        if not inspect(engine).has_table(Business.__tablename__):
            return                      # first boot; create_all has nothing to fill
        from app.db import SessionLocal
        db = SessionLocal()
        try:
            counts = backfill_timezones(db)
        finally:
            db.close()
        if counts["filled"] or counts["unresolved"]:
            _log.info(
                "timezone backfill: %d filled, %d could not be determined, %d already set",
                counts["filled"], counts["unresolved"], counts["already_set"],
            )
    except Exception:
        _log.exception("timezone backfill failed; continuing without it")

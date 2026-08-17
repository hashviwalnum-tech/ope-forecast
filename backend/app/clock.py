"""
The single source of "what time is it?" for the whole backend.

Two jobs:

1. **Correctness.**  A business's "today" is the date on *its own* wall clock,
   not the server's.  Render runs in UTC, so a New York restaurant's server
   rolls over to tomorrow at 19:00–20:00 local — right as it is closing — and an
   Israeli business's server is still on yesterday until 02:00–03:00 local.
   Every "today", "now" and "current hour" in the app must therefore be derived
   from ``business.settings["timezone"]``, which is what the helpers below do.

2. **Testability.**  Long-horizon behaviour (a year of day rollovers, accuracy
   windows, ad/event windows, retention caps) cannot be exercised without the
   app being able to believe that "now" is an arbitrary moment.  ``freeze()``
   provides that.

Storage convention, unchanged: timestamps are persisted as **naive UTC**.
Writers should use :func:`now_naive_utc`; readers convert with the helpers in
``app.engine.live_sales``.

SAFETY — how the override is kept out of production
---------------------------------------------------
``freeze()`` refuses to do anything unless the environment variable
``OPE_SIMULATED_CLOCK`` is truthy, AND refuses outright when the process looks
like a real deployment (Render sets ``RENDER``; a Postgres ``DATABASE_URL``
means a real database).  ``OPE_SIMULATED_CLOCK`` is not set in Render, not in
``.env.example``, and not in any deployment config — it is set only by the
simulation harness, in-process, against a local SQLite file.  Two tests pin this
down: one asserts the clock is live by default, one asserts ``freeze()`` raises
when the flag is absent.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

_SIM_FLAG = "OPE_SIMULATED_CLOCK"

_frozen: datetime | None = None

UTC = timezone.utc
DEFAULT_TZ = "UTC"


# ── The override (test-only) ──────────────────────────────────────────────────

def simulation_enabled() -> bool:
    """True only when the test-only flag is set on a non-deployed process."""
    if os.environ.get(_SIM_FLAG, "").strip().lower() not in ("1", "true", "yes", "on"):
        return False
    if os.environ.get("RENDER"):
        return False
    db = os.environ.get("DATABASE_URL", "")
    if db and not db.startswith("sqlite"):
        return False
    return True


def freeze(moment: datetime) -> None:
    """Pin ``now`` to ``moment`` (aware; naive is read as UTC).  Test-only."""
    global _frozen
    if not simulation_enabled():
        raise RuntimeError(
            "Refusing to override the clock: this is a test-only facility. "
            f"Set {_SIM_FLAG}=true, and only against a local SQLite database."
        )
    _frozen = moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def unfreeze() -> None:
    """Return to the real clock."""
    global _frozen
    _frozen = None


def is_frozen() -> bool:
    return _frozen is not None


# ── Reading the time ──────────────────────────────────────────────────────────

def now_utc() -> datetime:
    """Current moment as an aware UTC datetime."""
    if _frozen is not None and simulation_enabled():
        return _frozen.astimezone(UTC)
    return datetime.now(UTC)


def now_naive_utc() -> datetime:
    """Current moment as a naive UTC datetime — the storage convention."""
    return now_utc().replace(tzinfo=None)


# ── Business-local time (the correctness half) ────────────────────────────────

def tz_name(settings: dict | None) -> str:
    """The business's IANA timezone, falling back to UTC when unconfigured."""
    return (settings or {}).get("timezone") or DEFAULT_TZ


def now_local(settings: dict | None) -> datetime:
    """Current moment on the business's own wall clock."""
    try:
        return now_utc().astimezone(ZoneInfo(tz_name(settings)))
    except Exception:
        # An unknown/typo'd tz name must never 500 an endpoint.
        return now_utc()


def today_local(settings: dict | None) -> date:
    """The business's *own* today — never the server's."""
    return now_local(settings).date()


def hour_local(settings: dict | None) -> int:
    """The current hour (0–23) on the business's own wall clock."""
    return now_local(settings).hour

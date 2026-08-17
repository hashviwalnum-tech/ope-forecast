"""
Tier limit definitions and enforcement helpers.

These are pure functions — no DB, no framework — so they can be tested
directly and reused from any API route.
"""
from dataclasses import dataclass
from datetime import date, timedelta

FREE = "free"
PREMIUM = "premium"


@dataclass(frozen=True)
class Tier:
    """A tier that has been **resolved from authoritative state**.

    Existing as a distinct type is the whole point.  The tier used to be read
    straight off ``Business.settings["tier"]`` — a cache that only some code paths
    refreshed — and every leak we found (the trial that never ended, the three
    Telegram bot gates) was some code reading that cache without refreshing it
    first.  Making the limit helpers demand a ``Tier`` rather than a ``str``
    means a caller cannot reach them at all without going through
    ``app.api.deps.resolve_tier``, which reads the subscription.  Forgetting is
    now a type error rather than a silent entitlement leak.

    ``Business`` deliberately has no ``.tier`` attribute any more, so the old
    mistake will not even run.
    """

    value: str

    def __post_init__(self) -> None:
        if self.value not in (FREE, PREMIUM):
            raise ValueError(f"tier must be {FREE!r} or {PREMIUM!r}, got {self.value!r}")

    @property
    def is_premium(self) -> bool:
        return self.value == PREMIUM

    def __str__(self) -> str:
        return self.value


def _fmt_hour(h: int) -> str:
    """Friendly label: 0→'midnight', 12→'noon', 9→'9 am', 17→'5 pm'."""
    if h == 0:
        return "midnight"
    if h == 12:
        return "noon"
    if h < 12:
        return f"{h} am"
    return f"{h - 12} pm"

FREE_HISTORY_DAYS = 365
FREE_EVENTS_LIMIT = 10   # one-off events; §10 spec: generous expanded allowance
FREE_ADS_LIMIT = 5       # ads remain gated but expanded from 2


def history_cutoff(tier: Tier, today: date) -> date | None:
    """Oldest accessible date for this tier, or None for unlimited."""
    if tier.is_premium:
        return None
    return today - timedelta(days=FREE_HISTORY_DAYS)


def check_history(tier: Tier, record_date: date, today: date) -> None:
    """Raise ValueError if a free account is trying to add/access a date beyond the cap.

    The boundary date itself (exactly 365 days ago) is allowed.
    """
    cutoff = history_cutoff(tier, today)
    if cutoff is not None and record_date < cutoff:
        raise ValueError(
            f"Your free plan keeps up to 1 year of history "
            f"(dates from {cutoff} onward). "
            f"The date {record_date} is older than that. "
            f"Upgrade to premium to log and access more history."
        )


def check_not_in_the_future(record_date: date, today: date) -> None:
    """Raise ValueError if the owner is trying to log a day that hasn't happened.

    Nothing stopped this before, so a mistyped year (2027 for 2026) was accepted
    in silence, and then quietly did damage in two places: the phantom day joined
    the forecast's training history, and its "sales" were subtracted from
    projected stock with no matching delivery ever arriving.
    """
    if record_date > today:
        raise ValueError(
            f"{record_date} hasn't happened yet — you can only log days up to today "
            f"({today}). Check the date and try again."
        )


def check_entry_timing(
    record_date: date,
    today: date,
    current_hour: int,
    opening_hour: int | None,
    closing_hour: int | None,
) -> None:
    """Raise ValueError if today's record cannot be logged or edited yet.

    Only today is ever gated.  Past dates are always allowed — that is the
    "genuinely past days remain editable" exception from the spec.

    If the business has not configured opening/closing hours (either value is
    None), the check is skipped entirely so no-hours businesses are unaffected.

    Blocking conditions for today:
    - current_hour < opening_hour  → day hasn't started yet
    - opening_hour ≤ current_hour < closing_hour → business is still open
    Allowed when current_hour >= closing_hour (day is finished).
    """
    if record_date != today:
        return  # past dates always allowed
    if opening_hour is None or closing_hour is None:
        return  # no hours configured — nothing to enforce
    if current_hour >= closing_hour:
        return  # business is closed for the day — allow

    close_str = _fmt_hour(closing_hour)
    if current_hour < opening_hour:
        raise ValueError(
            f"Today hasn't started yet (your opening hour is {_fmt_hour(opening_hour)}). "
            f"Come back after closing ({close_str}) to log today's numbers."
        )
    raise ValueError(
        f"Your business is still open until {close_str}. "
        f"Log today's totals after you close — that way the count will be complete."
    )


def check_non_working_day(
    record_date: date,
    today: date,
    opening_days: list[int] | None,
) -> None:
    """Raise ValueError if today is a non-working day and we're trying to log it.

    Only today is gated — past dates are always editable via the backfill screen.
    If opening_days is None or empty the check is skipped (no schedule configured).
    """
    if record_date != today:
        return
    if not opening_days:
        return
    if today.weekday() not in opening_days:
        day_name = today.strftime("%A")
        raise ValueError(
            f"{day_name} is not a working day for your business. "
            f"You can still edit past days from the Past Days screen."
        )


def check_periods(tier: Tier, current_count: int, period_type: str = "event") -> None:
    """Raise ValueError if a free account has hit the per-type periods cap.

    Events and ads have separate limits (§10: events generous, ads gated).
    RecurringPatterns are always unlimited and free — do not call this for them.
    """
    if tier.is_premium:
        return
    if period_type == "ad":
        limit = FREE_ADS_LIMIT
        kind = "ads"
    else:
        limit = FREE_EVENTS_LIMIT
        kind = "events"
    if current_count >= limit:
        raise ValueError(
            f"Your free plan allows up to {limit} saved {kind}. "
            f"Delete one to make room, or upgrade to premium for unlimited tracking."
        )

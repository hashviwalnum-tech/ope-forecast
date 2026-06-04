"""
Tier limit definitions and enforcement helpers.

These are pure functions — no DB, no framework — so they can be tested
directly and reused from any API route.
"""
from datetime import date, timedelta


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


def history_cutoff(tier: str, today: date) -> date | None:
    """Oldest accessible date for this tier, or None for unlimited."""
    if tier == "premium":
        return None
    return today - timedelta(days=FREE_HISTORY_DAYS)


def check_history(tier: str, record_date: date, today: date) -> None:
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


def check_periods(tier: str, current_count: int, period_type: str = "event") -> None:
    """Raise ValueError if a free account has hit the per-type periods cap.

    Events and ads have separate limits (§10: events generous, ads gated).
    RecurringPatterns are always unlimited and free — do not call this for them.
    """
    if tier == "premium":
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

"""
Tier limit definitions and enforcement helpers.

These are pure functions — no DB, no framework — so they can be tested
directly and reused from any API route.
"""
from datetime import date, timedelta

FREE_HISTORY_DAYS = 365
FREE_PERIODS_LIMIT = 2


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


def check_periods(tier: str, current_count: int) -> None:
    """Raise ValueError if a free account has hit the active periods cap."""
    if tier == "premium":
        return
    if current_count >= FREE_PERIODS_LIMIT:
        raise ValueError(
            f"Your free plan allows up to {FREE_PERIODS_LIMIT} saved ads or events. "
            f"Delete one to make room, or upgrade to premium for unlimited tracking."
        )

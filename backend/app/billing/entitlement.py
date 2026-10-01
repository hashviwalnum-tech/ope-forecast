"""Whether an account has premium right now — the one rule, as a pure function.

No database, no network, no clock of its own: everything it needs is passed in,
so every case below has a known-answer test (tests/test_billing_entitlement.py).
``Subscription.effective_tier`` calls this, and ``resolve_tier`` reads that, so
this is the single place the answer is decided.

Three independent ways to hold premium, any one of which is enough:

1. **A manual grant** (pilot businesses), optionally with an end date.  It only
   ever *adds* premium — nothing about a grant can take premium away from
   someone who is paying.
2. **The free trial**, until it ends.
3. **A Google Play subscription**, by its normalised status:

   ``active``     paid and renewing.  Premium until the paid-through date, plus
                  a day of leeway so a renewal that Google reports a few hours
                  late does not briefly lock out a paying owner.
   ``grace``      a renewal payment failed and Google is retrying.  Google
                  requires the app to keep access during the grace period, so
                  premium — with no date check, because Google moves the end
                  date itself and the next notification ends the state.
   ``cancelled``  the owner turned off auto-renew.  They have paid up to the
                  paid-through date and keep premium exactly until then.
   anything else  (``on_hold``, ``paused``, ``expired``, ``pending``,
                  ``unknown``, ``none``) — no premium from the subscription.

A refund that revokes access arrives from Google as ``expired``, so it needs no
case of its own.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

RENEWAL_LEEWAY = timedelta(hours=24)

#: Statuses where Google will keep charging unless someone cancels — used by
#: account deletion, which must not leave a renewing subscription behind.
RENEWING_STATUSES = frozenset({"active", "grace", "on_hold", "paused"})


def _utc(dt: datetime | None) -> datetime | None:
    """DateTime columns come back naive; everything stored is UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def grant_is_active(now: datetime, granted: bool, grant_ends_at: datetime | None) -> bool:
    if not granted:
        return False
    ends = _utc(grant_ends_at)
    return ends is None or _utc(now) < ends


def subscription_is_entitled(now: datetime, status: str, paid_through: datetime | None) -> bool:
    now = _utc(now)
    paid = _utc(paid_through)
    if status == "grace":
        return True
    if status == "active":
        # A row with no date predates Play (the old stub wrote "active" alone).
        return paid is None or now < paid + RENEWAL_LEEWAY
    if status == "cancelled":
        return paid is not None and now < paid
    return False


def is_premium(
    now: datetime,
    *,
    tier: str,
    trial_ends_at: datetime | None,
    status: str,
    paid_through: datetime | None,
    granted: bool = False,
    grant_ends_at: datetime | None = None,
) -> bool:
    if grant_is_active(now, granted, grant_ends_at):
        return True
    trial_end = _utc(trial_ends_at)
    if tier == "trial" and trial_end is not None and _utc(now) < trial_end:
        return True
    return subscription_is_entitled(now, status, paid_through)

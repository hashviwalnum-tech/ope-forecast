"""
When a tap made earlier — saved on the phone while it had no signal — happened.

Pure functions — no DB, no framework imports.

The phone queues a tap the moment it is made and sends it when it can, which
may be minutes or hours later. Stamping it with the time it *arrived* would put
a 10am rush at 1pm, and a tap queued before closing into the next day. So the
phone sends the time the tap was made, and the server keeps it.

Two things make that time untrustworthy, and both are handled here:

* **The phone's clock may be wrong.** The phone also sends the time on its own
  clock at the moment of sending. The gap between that and the server's clock
  is the phone's error, and the same error applies to the tap. It is corrected
  only when it is large (over two minutes), and then rounded to five minutes,
  so a re-send of the same tap a few seconds later gets the *same* corrected
  time — which is what lets the server recognise it as a repeat (see
  ``app/api/sale_events.py``) instead of counting the sale twice.
* **A tap cannot be in the future,** and one far in the past is more likely a
  confused phone than a real sale, so it is refused rather than slipped into
  history unseen.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from app.engine.limits import RuleError

# Below this the phone's clock is trusted as it is: network time keeps phones
# within seconds, and an uncorrected time is exactly reproducible on a re-send.
CLOCK_TRUST = timedelta(minutes=2)
# A large error is corrected in steps this size, so the few seconds a re-send
# takes do not change the corrected time.
CLOCK_STEP = timedelta(minutes=5)
# A queued tap older than this is refused, not stored.
MAX_AGE = timedelta(days=30)


def _to_ms(ts: datetime) -> datetime:
    """Milliseconds, the precision a phone's clock reports — so the stored time
    equals the time on a re-send exactly, whatever the database keeps."""
    return ts.replace(microsecond=(ts.microsecond // 1000) * 1000)


def resolve_tap_time(
    server_now: datetime,
    tapped_at: datetime | None,
    sent_at: datetime | None,
) -> datetime:
    """The time to store a tap at. All three are naive UTC.

    ``tapped_at`` is when the owner tapped, on the phone's clock; ``sent_at`` is
    the phone's clock when it sent the tap. With no ``tapped_at`` (an older
    client, or the web app) the tap happened now.
    """
    if tapped_at is None:
        return server_now

    ts = tapped_at
    if sent_at is not None:
        skew = server_now - sent_at
        if abs(skew) > CLOCK_TRUST:
            steps = round(skew / CLOCK_STEP)
            ts = ts + steps * CLOCK_STEP

    if ts > server_now:
        ts = server_now
    if server_now - ts > MAX_AGE:
        raise RuleError(
            "tap_too_old",
            f"A sale saved on the phone on {ts.date()} was not sent in time and "
            f"was not added. If it was real, add it to that day under Past days.",
            date=ts.date().isoformat(),
        )
    return _to_ms(ts)

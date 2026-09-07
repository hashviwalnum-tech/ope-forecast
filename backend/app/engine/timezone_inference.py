"""Working out an existing business's timezone, or honestly admitting we can't.

A business created before the timezone field existed has none, and
`clock.today_local` then falls back to UTC — so an owner east of London has
their evening filed under tomorrow, and one west of it has their late night
filed under yesterday. New businesses set it at creation; the ones already in
the database need a value found for them.

This is the "finding" half, kept pure so it can be tested against known answers
and so nothing about it depends on a database.

TWO SIGNALS, AND A REFUSAL
--------------------------
1. **The currency.** Most currencies belong to exactly one country in exactly
   one timezone: ILS is Asia/Jerusalem, JPY is Asia/Tokyo, GBP is Europe/London.
   That is a fact, not a guess, and it carries real DST rules with it.

2. **When the business is actually open.** Sale events are stored as naive UTC.
   If an owner says they open 09:00–17:00 and their taps cluster at 14:00–22:00
   UTC, they are five hours behind UTC. That narrows a wide currency (USD spans
   six zones) to one, and it can stand alone when the currency says nothing.

3. **Neither** — and then this returns None, deliberately. A guessed zone is
   worse than an absent one: absent is visibly unset and the app can ask, while
   wrong silently files a day's takings under the wrong date, which is the exact
   harm the field exists to prevent. Refusing is a result, not a failure.
"""
from __future__ import annotations

from dataclasses import dataclass

# ── currency → the zones a business using it plausibly sits in ───────────────
#
# Only currencies whose country is unambiguous enough to be useful. A currency
# with one entry settles the question on its own; one with several needs the
# activity evidence to choose between them. Currencies not listed here (EUR
# above all — twenty countries, four zones, and an owner could be in any of
# them) contribute nothing, which is the honest answer for them.
CURRENCY_ZONES: dict[str, tuple[str, ...]] = {
    "ILS": ("Asia/Jerusalem",),
    "GBP": ("Europe/London",),
    "JPY": ("Asia/Tokyo",),
    "KRW": ("Asia/Seoul",),
    "CNY": ("Asia/Shanghai",),
    "INR": ("Asia/Kolkata",),
    "PKR": ("Asia/Karachi",),
    "BDT": ("Asia/Dhaka",),
    "IDR": ("Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"),
    "TRY": ("Europe/Istanbul",),
    "SGD": ("Asia/Singapore",),
    "HKD": ("Asia/Hong_Kong",),
    "THB": ("Asia/Bangkok",),
    "VND": ("Asia/Ho_Chi_Minh",),
    "PHP": ("Asia/Manila",),
    "MYR": ("Asia/Kuala_Lumpur",),
    "AED": ("Asia/Dubai",),
    "SAR": ("Asia/Riyadh",),
    "EGP": ("Africa/Cairo",),
    "ZAR": ("Africa/Johannesburg",),
    "NGN": ("Africa/Lagos",),
    "KES": ("Africa/Nairobi",),
    "MAD": ("Africa/Casablanca",),
    "CHF": ("Europe/Zurich",),
    "SEK": ("Europe/Stockholm",),
    "NOK": ("Europe/Oslo",),
    "DKK": ("Europe/Copenhagen",),
    "PLN": ("Europe/Warsaw",),
    "CZK": ("Europe/Prague",),
    "HUF": ("Europe/Budapest",),
    "RON": ("Europe/Bucharest",),
    "UAH": ("Europe/Kyiv",),
    "NZD": ("Pacific/Auckland",),
    "MXN": ("America/Mexico_City",),
    "BRL": ("America/Sao_Paulo",),
    "ARS": ("America/Argentina/Buenos_Aires",),
    "CLP": ("America/Santiago",),
    "COP": ("America/Bogota",),
    "PEN": ("America/Lima",),
    "USD": (
        "America/New_York", "America/Chicago", "America/Denver",
        "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
    ),
    "CAD": (
        "America/Toronto", "America/Winnipeg", "America/Edmonton",
        "America/Vancouver", "America/Halifax",
    ),
    "AUD": (
        "Australia/Sydney", "Australia/Brisbane", "Australia/Adelaide",
        "Australia/Perth", "Australia/Darwin",
    ),
    "RUB": ("Europe/Moscow", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Vladivostok"),
}

# Every zone the activity signal may propose when the currency says nothing.
# One per whole-hour offset in the inhabited range, each a real place with real
# DST rules — a fixed "Etc/GMT-3" would be wrong twice a year.
ZONES_BY_OFFSET: tuple[str, ...] = (
    "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles",
    "America/Denver", "America/Chicago", "America/New_York",
    "America/Halifax", "America/Sao_Paulo", "Atlantic/Azores",
    "Europe/London", "Europe/Paris", "Europe/Athens", "Europe/Moscow",
    "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka",
    "Asia/Bangkok", "Asia/Shanghai", "Asia/Tokyo", "Australia/Brisbane",
    "Pacific/Noumea", "Pacific/Auckland",
)

# How much better the best zone must fit than the runner-up before the activity
# signal is allowed to decide anything, as a fraction of events placed inside
# opening hours.
#
# Sized against the worst realistic case: a business whose taps exactly fill its
# stated opening hours. Being one hour out then pushes a single hour's worth of
# activity outside the window — over an eight-hour day that is a 12% difference,
# so the threshold sits just below it. Anything looser starts choosing between
# neighbouring zones on noise; anything tighter refuses cases that are decided.
#
# Being one zone out is also the mildest way to be wrong: it shifts "today" by
# an hour, and only misfiles a day for a business trading across midnight.
MIN_ACTIVITY_MARGIN = 0.10

# Below this, there is not enough activity to read anything from.
MIN_ACTIVITY_EVENTS = 20

# And the winner must actually fit: a zone that puts a third of the taps outside
# opening hours has not explained the data, it has merely beaten worse options.
MIN_ACTIVITY_FIT = 0.70


@dataclass(frozen=True)
class TimezoneGuess:
    """What was worked out, and on what basis.

    `zone` is None when nothing could be established. `reason` is written to be
    readable in the backfill's output — someone reviewing a hundred businesses
    needs to see WHY each got what it got.
    """
    zone: str | None
    source: str          # 'currency' | 'activity' | 'currency+activity' | 'unknown'
    confidence: float    # 0–1; 1.0 when the currency alone settles it
    reason: str


def zones_for_currency(currency: str | None) -> tuple[str, ...]:
    """Candidate zones for a currency; empty when it tells us nothing."""
    if not currency:
        return ()
    return CURRENCY_ZONES.get(currency.strip().upper(), ())


def _hours_local(utc_hours: list[int], offset_hours: float) -> list[float]:
    return [(h + offset_hours) % 24 for h in utc_hours]


def _fit(local_hours: list[float], opening_hour: int, closing_hour: int) -> float:
    """Fraction of events falling inside the business's stated opening hours.

    A window that wraps past midnight (opens 20:00, closes 02:00) is handled —
    late-night businesses exist and would otherwise score zero everywhere.
    """
    if not local_hours:
        return 0.0
    if opening_hour == closing_hour:
        return 0.0
    inside = 0
    for h in local_hours:
        if opening_hour < closing_hour:
            if opening_hour <= h < closing_hour:
                inside += 1
        else:                                  # wraps midnight
            if h >= opening_hour or h < closing_hour:
                inside += 1
    return inside / len(local_hours)


def _offset_hours(zone: str, sample_utc_hour: int = 12) -> float:
    """A zone's offset from UTC, in hours, at a fixed reference instant.

    Whole-hour arithmetic on a representative January date. It is deliberately
    coarse: this only has to rank candidate zones, and any finer treatment of
    DST would give a false impression of precision on data that is a scatter of
    tap times.
    """
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo
    try:
        ref = datetime(2026, 1, 15, sample_utc_hour, tzinfo=timezone.utc)
        return ref.astimezone(ZoneInfo(zone)).utcoffset().total_seconds() / 3600.0  # type: ignore[union-attr]
    except Exception:
        return 0.0


def infer_from_activity(
    utc_hours: list[int],
    opening_hour: int | None,
    closing_hour: int | None,
    candidates: tuple[str, ...] | None = None,
) -> TimezoneGuess:
    """Which timezone best explains when this business is actually busy.

    `utc_hours` are the hours (0–23) of the business's sale events, read in UTC
    — which is how they are stored. The zone that puts the most of them inside
    the owner's stated opening hours is the one they are most likely in.
    """
    zones = candidates or ZONES_BY_OFFSET
    if opening_hour is None or closing_hour is None:
        return TimezoneGuess(None, "unknown", 0.0,
                             "no opening hours recorded, so activity proves nothing")
    if len(utc_hours) < MIN_ACTIVITY_EVENTS:
        return TimezoneGuess(None, "unknown", 0.0,
                             f"only {len(utc_hours)} recorded sale times; needs "
                             f"{MIN_ACTIVITY_EVENTS}")

    scored = sorted(
        ((_fit(_hours_local(utc_hours, _offset_hours(z)), opening_hour, closing_hour), z)
         for z in zones),
        key=lambda pair: (-pair[0], pair[1]),
    )
    best_fit, best_zone = scored[0]
    runner_up = scored[1][0] if len(scored) > 1 else 0.0

    if best_fit < MIN_ACTIVITY_FIT:
        return TimezoneGuess(
            None, "unknown", best_fit,
            f"no zone explains the sale times well (best {best_zone} fits only "
            f"{best_fit:.0%} of them inside {opening_hour}:00–{closing_hour}:00)",
        )
    if len(zones) > 1 and best_fit - runner_up < MIN_ACTIVITY_MARGIN:
        return TimezoneGuess(
            None, "unknown", best_fit,
            f"{best_zone} fits {best_fit:.0%} but the next-best is {runner_up:.0%} — "
            "too close to call from activity alone",
        )
    return TimezoneGuess(
        best_zone, "activity", best_fit,
        f"{best_fit:.0%} of sale times land inside {opening_hour}:00–{closing_hour}:00 "
        f"in {best_zone}",
    )


def infer_timezone(
    currency: str | None,
    utc_hours: list[int],
    opening_hour: int | None,
    closing_hour: int | None,
) -> TimezoneGuess:
    """Best available answer for a business with no timezone set.

    The currency is trusted first where it is decisive, because it is a fact
    about the business rather than an inference from a scatter of timestamps.
    Where it narrows without deciding, the activity chooses among its
    candidates. Where it says nothing, activity may still answer alone. Where
    neither does, this returns None and says why.
    """
    candidates = zones_for_currency(currency)

    if len(candidates) == 1:
        return TimezoneGuess(
            candidates[0], "currency", 1.0,
            f"{currency} is used in one timezone",
        )

    if len(candidates) > 1:
        guess = infer_from_activity(utc_hours, opening_hour, closing_hour, candidates)
        if guess.zone:
            return TimezoneGuess(
                guess.zone, "currency+activity", guess.confidence,
                f"{currency} narrows it to {len(candidates)} zones; {guess.reason}",
            )
        return TimezoneGuess(
            None, "unknown", guess.confidence,
            f"{currency} spans {len(candidates)} zones and {guess.reason}",
        )

    guess = infer_from_activity(utc_hours, opening_hour, closing_hour)
    if guess.zone:
        return guess
    return TimezoneGuess(
        None, "unknown", guess.confidence,
        f"no usable currency and {guess.reason}",
    )

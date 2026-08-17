"""
The simulated business — the ANSWER KEY for the year-long release test.

Implements the demand model in the mission brief §6 exactly.  This module is
deliberately isolated:

  * nothing under ``backend/app/`` may import it,
  * no forecasting-engine change may be justified by a constant defined here,
  * it is seeded and fully reproducible.

Applied in order (§6):  day-level modifiers → hour distribution →
hour-level modifiers → product split.

DOCUMENTED ASSUMPTIONS (the brief is ambiguous on these; both are recorded in
docs/simulation/REPORT.md):

  A1. Percentage modifiers compose MULTIPLICATIVELY (a hit of "−10%" means
      ×0.90).  Sequential additive modifiers could drive a Sunday to −70% and
      make the series degenerate; multiplicative is the standard reading of
      stacked percentage effects and keeps demand strictly positive.
  A2. "Open 09:00–17:00" means eight serving hours 09,10,…,16 (the shop stops
      serving at 17:00).  That maps cleanly onto the brief's two hour bands:
      shoulder = {9,10,11,16}, peak = {12,13,14,15}.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import date, timedelta

from tests.simulation.menu import (
    BY_KEY,
    COLESLAW_PORTION_WEIGHTS,
    COLESLAW_PORTIONS,
    DESSERTS,
    DRINKS,
    MAINS,
    MENU,
    P_BOOKS_SERVICE,
    P_BUYS_DESSERT,
    P_BUYS_DRINK,
    P_BUYS_MAIN,
    P_BUYS_SIDE,
    P_DRINK_QTY2,
    P_MAIN_QTY2,
    P_SIDE_QTY2,
    SERVICES,
    SIDES,
    similarity_matrix,
)

# ── World constants ───────────────────────────────────────────────────────────

BASE_CUSTOMERS = 500
TIMEZONE = "America/New_York"

CLOSED_WEEKDAY = 5           # Saturday (Python weekday(): 0=Mon … 6=Sun)
SUNDAY = 6

OPEN_HOUR = 9
CLOSE_HOUR = 17
SERVING_HOURS = list(range(OPEN_HOUR, CLOSE_HOUR))      # 9..16  (assumption A2)
SHOULDER_HOURS = {9, 10, 11, 16}
PEAK_HOURS = {12, 13, 14, 15}

# Simulated year: 365 days, entirely in the past relative to the real clock, and
# spanning both US daylight-saving transitions (2025-11-02 and 2026-03-08).
YEAR_START = date(2025, 8, 1)
YEAR_DAYS = 365

# §6.7 — a slow demand trend that begins mid-year, so drift detection has
# something real to find.  +0.11%/day compounding from day 180 → about +23% by
# day 365.  The app can only ever observe the resulting numbers.
TREND_START_DAY = 180
TREND_DAILY_RATE = 0.0011

# §6.1 — Sunday day-level rolls: (probability, multiplier-if-hit)
SUNDAY_ROLLS_PRIMARY = [(0.80, 0.90), (0.70, 0.90), (0.50, 0.90), (0.60, 0.90)]
SUNDAY_ROLLS_EXTRA = [(0.10, 0.90), (0.20, 0.90), (0.30, 0.90)]

# §6.2 — every other open day
WEEKDAY_ROLLS = [
    (0.60, 1.05),
    (0.70, 1.05),
    (0.40, 0.95),
    (0.65, 0.95),
    (0.10, 0.90),
]

# §6.3 — independent day-level shocks
SHOCK_DOWN_P, SHOCK_DOWN_M = 0.05, 0.75
SHOCK_UP_P, SHOCK_UP_M = 0.05, 1.25

# §6.4 — hour ladders.  Each rung fires only if every earlier rung MISSED.
DECREASE_LADDER = [(0.50, 0.95), (0.50, 0.90), (0.50, 0.85), (0.50, 0.80)]
INCREASE_LADDER = [(0.50, 1.05), (0.50, 1.10), (0.50, 1.15), (0.50, 1.20)]
SHOULDER_BONUS_P, SHOULDER_BONUS_M = 0.30, 1.10   # upward → survives promos
PEAK_PENALTY_P, PEAK_PENALTY_M = 0.30, 0.90       # downward → suppressed by promos

DEFAULT_SEED = "ope-nyc-burger-2025-v1"


# ── Promotions (§6.5) ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Promo:
    label: str
    kind: str          # "ad" | "event"
    start: date
    end: date          # inclusive
    target: str        # menu key, or "customers"
    cost: float | None = None


def _d(offset: int) -> date:
    return YEAR_START + timedelta(days=offset)


# A realistic year: eleven ads and eight events, including a multi-day event, an
# overlapping ad/event pair, and an ad that runs over a Sunday.  Deliberately
# past the free tier's caps (5 ads / 10 events) so the limits are exercised.
PROMOS: list[Promo] = [
    Promo("Opening-week flyers",        "ad",    _d(6),   _d(9),   "customers", 400),
    Promo("Labor Day cookout",          "event", _d(30),  _d(31),  "customers", None),
    Promo("Instagram burger push",      "ad",    _d(47),  _d(49),  "classic_burger", 650),
    Promo("Milkshake Monday radio",     "ad",    _d(66),  _d(66),  "milkshake", 220),
    # Sunday-only ad — _d(86) is Sunday 2025-10-26.
    Promo("Sunday family deal",         "ad",    _d(86),  _d(86),  "customers", 300),
    Promo("Halloween week",             "event", _d(90),  _d(96),  "customers", None),
    # Overlapping pair: the ad runs inside the event window.
    Promo("Halloween combo ad",         "ad",    _d(93),  _d(97),  "double_burger", 500),
    Promo("Thanksgiving eve",           "event", _d(115), _d(115), "customers", None),
    Promo("Local paper feature",        "ad",    _d(140), _d(143), "customers", 800),
    Promo("New Year kickoff",           "event", _d(152), _d(154), "customers", None),
    Promo("Veggie launch push",         "ad",    _d(170), _d(174), "veggie_burger", 450),
    Promo("Valentine's night",          "event", _d(196), _d(196), "customers", None),
    Promo("Spring coupon drop",         "ad",    _d(215), _d(219), "fries", 350),
    Promo("March Madness screenings",   "event", _d(228), _d(234), "customers", None),
    Promo("Delivery-app promo",         "ad",    _d(252), _d(255), "customers", 900),
    Promo("Memorial Day weekend",       "event", _d(298), _d(300), "customers", None),
    Promo("Summer shake campaign",      "ad",    _d(316), _d(320), "milkshake", 600),
    Promo("July 4th block party",       "event", _d(337), _d(338), "customers", None),
    Promo("Back-to-school flyers",      "ad",    _d(352), _d(355), "customers", 380),
    # Three more events so the year exceeds the free tier's 10-event allowance.
    Promo("Street fair",                "event", _d(60),  _d(60),  "customers", None),
    Promo("Super Bowl Sunday",          "event", _d(191), _d(191), "customers", None),
    Promo("Mother's Day lunch",         "event", _d(285), _d(285), "customers", None),
]


def promos_active_on(day: date) -> list[Promo]:
    return [p for p in PROMOS if p.start <= day <= p.end]


# ── Owner messiness (§6.7) ────────────────────────────────────────────────────

# Days the owner simply never logged (absent, NOT zero — the app must not
# average these in as zeros).
FORGOTTEN_DAYS: set[date] = {_d(58), _d(213)}

# Days the owner logged late, in a catch-up batch several days afterwards.
LATE_LOGGED_DAYS: dict[date, int] = {_d(122): 4, _d(123): 3, _d(124): 2, _d(276): 5}

# A genuine one-off disaster the owner will mark as a fluke: a burst water main
# closes the street.  Value is a hard multiplier applied after everything else.
ANOMALY_DAYS: dict[date, float] = {_d(188): 0.22, _d(305): 2.35}


# ── Outcome types ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class HourOutcome:
    hour: int
    customers: int
    units: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class DayOutcome:
    day: date
    index: int
    is_open: bool
    customers: int
    hours: list[HourOutcome]
    units: dict[str, float]
    promo_active: bool
    promos: list[str]
    anomaly: bool
    logged: bool                    # False for FORGOTTEN_DAYS
    log_delay_days: int             # 0 = logged at the normal rollover


# ── Core rolls ────────────────────────────────────────────────────────────────

def _day_rng(seed: str, day: date, salt: str = "") -> random.Random:
    """A fresh RNG for one day, derived from the master seed.

    Per-day derivation (rather than one long stream) means a single day can be
    re-rolled thousands of times for the Monte-Carlo noise floor without
    disturbing any other day.
    """
    return random.Random(f"{seed}|{day.isoformat()}|{salt}")


def _apply_rolls(rng: random.Random, rolls, suppress_down: bool) -> float:
    """Independent sequential rolls; each hit multiplies.  Assumption A1."""
    m = 1.0
    for p, mult in rolls:
        hit = rng.random() < p
        # The RNG is always consumed so suppression does not desynchronise the
        # stream between a promo day and the same day without a promo.
        if hit and not (suppress_down and mult < 1.0):
            m *= mult
    return m


def _ladder(rng: random.Random, ladder, suppress: bool) -> float:
    """First-hit-wins ladder: rung k only fires if rungs 0..k-1 all missed."""
    m = 1.0
    fired = False
    for p, mult in ladder:
        hit = rng.random() < p
        if hit and not fired:
            fired = True
            if not suppress:
                m = mult
    return m


def day_multiplier(rng: random.Random, day: date, promo: bool) -> float:
    """Day-level multiplier from §6.1–6.3, before the hour band effects."""
    if day.weekday() == SUNDAY:
        m = _apply_rolls(rng, SUNDAY_ROLLS_PRIMARY, promo)
        m *= _apply_rolls(rng, SUNDAY_ROLLS_EXTRA, promo)
    else:
        m = _apply_rolls(rng, WEEKDAY_ROLLS, promo)

    down = rng.random() < SHOCK_DOWN_P
    up = rng.random() < SHOCK_UP_P
    if down and not promo:
        m *= SHOCK_DOWN_M
    if up:
        m *= SHOCK_UP_M
    return m


def hour_multiplier(rng: random.Random, hour: int, promo: bool) -> float:
    """Hour-level multiplier from §6.4."""
    if hour in PEAK_HOURS:
        m = _ladder(rng, INCREASE_LADDER, suppress=False)
        if rng.random() < PEAK_PENALTY_P and not promo:
            m *= PEAK_PENALTY_M
        return m
    m = _ladder(rng, DECREASE_LADDER, suppress=promo)
    if rng.random() < SHOULDER_BONUS_P:
        m *= SHOULDER_BONUS_M
    return m


def trend_factor(index: int) -> float:
    """The slow mid-year demand trend (§6.7)."""
    if index < TREND_START_DAY:
        return 1.0
    return (1.0 + TREND_DAILY_RATE) ** (index - TREND_START_DAY)


# ── Product split with substitution (§6.6) ────────────────────────────────────

_SIM = similarity_matrix()


def _day_shares(rng: random.Random, promo_targets: set[str]) -> dict[str, float]:
    """Per-day category-relative shares after substitution.

    Independent per-product appetite shocks u are transformed by
    ``v = u − S·u`` so that a high day for one product pulls its near
    neighbours down and leaves distant products alone.  Shares are then
    renormalised inside each category, so the total customer count is untouched
    by the split — exactly the "total customers stay consistent" requirement.
    """
    keys = [m.key for m in MENU]
    u = {k: rng.gauss(0.0, 0.22) for k in keys}
    v = {k: u[k] - sum(_SIM[k][j] * u[j] for j in keys if j != k) for k in keys}
    for t in promo_targets:
        if t in v:
            v[t] += 0.35            # the ad genuinely shifts mix toward its target

    raw = {k: BY_KEY[k].base_share * pow(2.718281828, v[k]) for k in keys}
    shares: dict[str, float] = {}
    for group in (MAINS, SIDES, DRINKS, DESSERTS, SERVICES):
        tot = sum(raw[k] for k in group)
        for k in group:
            shares[k] = raw[k] / tot if tot > 0 else 0.0
    return shares


def _pick(rng: random.Random, group: list[str], shares: dict[str, float]) -> str:
    r = rng.random()
    acc = 0.0
    for k in group:
        acc += shares[k]
        if r < acc:
            return k
    return group[-1]


def _basket(rng: random.Random, shares: dict[str, float], out: dict[str, float]) -> None:
    """Assemble one customer's basket into ``out`` (units per product key)."""
    if rng.random() < P_BUYS_MAIN:
        k = _pick(rng, MAINS, shares)
        out[k] = out.get(k, 0.0) + (2 if rng.random() < P_MAIN_QTY2 else 1)
    if rng.random() < P_BUYS_SIDE:
        k = _pick(rng, SIDES, shares)
        if BY_KEY[k].unit_mode == "decimal":
            out[k] = out.get(k, 0.0) + rng.choices(COLESLAW_PORTIONS,
                                                   weights=COLESLAW_PORTION_WEIGHTS)[0]
        else:
            out[k] = out.get(k, 0.0) + (2 if rng.random() < P_SIDE_QTY2 else 1)
    if rng.random() < P_BUYS_DRINK:
        k = _pick(rng, DRINKS, shares)
        out[k] = out.get(k, 0.0) + (2 if rng.random() < P_DRINK_QTY2 else 1)
    if rng.random() < P_BUYS_DESSERT:
        k = _pick(rng, DESSERTS, shares)
        out[k] = out.get(k, 0.0) + 1
    if rng.random() < P_BOOKS_SERVICE:
        k = _pick(rng, SERVICES, shares)
        out[k] = out.get(k, 0.0) + 1


# ── The simulator ─────────────────────────────────────────────────────────────

def simulate_day(
    day: date,
    index: int,
    seed: str = DEFAULT_SEED,
    with_products: bool = True,
) -> DayOutcome:
    """Roll one calendar day of the simulated business."""
    if day.weekday() == CLOSED_WEEKDAY:
        return DayOutcome(day, index, False, 0, [], {}, False, [], False, True, 0)

    active = promos_active_on(day)
    promo = bool(active)
    promo_targets = {p.target for p in active if p.target != "customers"}

    rng = _day_rng(seed, day, "day")
    base = BASE_CUSTOMERS * trend_factor(index) * day_multiplier(rng, day, promo)
    base *= ANOMALY_DAYS.get(day, 1.0)

    per_hour_base = base / len(SERVING_HOURS)

    shares = _day_shares(_day_rng(seed, day, "mix"), promo_targets)

    hours: list[HourOutcome] = []
    units_total: dict[str, float] = {}
    total = 0
    for h in SERVING_HOURS:
        hrng = _day_rng(seed, day, f"h{h}")
        n = int(round(per_hour_base * hour_multiplier(hrng, h, promo)))
        n = max(0, n)
        total += n
        hu: dict[str, float] = {}
        if with_products:
            for _ in range(n):
                _basket(hrng, shares, hu)
            for k, q in hu.items():
                units_total[k] = units_total.get(k, 0.0) + q
        hours.append(HourOutcome(h, n, hu))

    return DayOutcome(
        day=day,
        index=index,
        is_open=True,
        customers=total,
        hours=hours,
        units={k: round(v, 3) for k, v in units_total.items()},
        promo_active=promo,
        promos=[p.label for p in active],
        anomaly=day in ANOMALY_DAYS,
        logged=day not in FORGOTTEN_DAYS,
        log_delay_days=LATE_LOGGED_DAYS.get(day, 0),
    )


def simulate_year(
    seed: str = DEFAULT_SEED,
    days: int = YEAR_DAYS,
    with_products: bool = True,
) -> list[DayOutcome]:
    """The full simulated year, closed days included (is_open=False)."""
    return [
        simulate_day(YEAR_START + timedelta(days=i), i, seed, with_products)
        for i in range(days)
    ]


def open_days(outcomes: list[DayOutcome]) -> list[DayOutcome]:
    return [o for o in outcomes if o.is_open]

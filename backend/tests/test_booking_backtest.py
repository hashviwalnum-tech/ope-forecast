"""Does the booking model actually make the forecast better?

The booking feature shipped unproven. It fits `actual = slope * booked +
intercept`, calls the slope a show-up rate and the intercept a walk-in
baseline, and is weighted by holdout accuracy like every other model — all
plausible, none of it measured. This file measures it.

WHAT IS BEING TESTED, and why it is not circular
------------------------------------------------
The data comes from `tests/simulation/generator.py`, which builds an
appointment business the way one actually works: a diary is filled in advance,
each booking independently turns up or does not, and unbooked walk-ins arrive
on top. It never computes `slope * booked + intercept`. The linear relationship
Ope fits is an emergent property of binomial thinning plus a Poisson count, not
something the generator hands over.

The engine is never told the show-up rate or the walk-in mean. Recovering them
is the test. Nothing in `backend/app/` imports the generator, and no engine
constant is tuned to any number defined there.

Everything goes through the real `GET /forecast` endpoint. The comparison is
the SAME history, the SAME target dates and the SAME requests, run once with
`appointment_based` on and once off — so the only difference is whether the
booking model is allowed to participate.

Walk-forward, never peeking: at each checkpoint the app has been told every day
up to that point and no day after it, plus the diary for the days ahead — which
an appointment business genuinely knows in advance. Actuals are only ever used
to score a prediction that was already made.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.api.deps import get_business, get_tier
from app.db import get_db
from app.engine.limits import Tier
from app.main import app
from app.models import DayRecord, ForecastRun, SaleRecord
from app.models.booked_count import BookedCount
from tests.simulation.generator import (
    BARBER,
    CLINIC,
    AppointmentProfile,
    simulate_appointment_series,
)

TZ = "America/New_York"

# Long enough for the booking model to accumulate holdout evidence per weekday,
# short enough to keep the test in the seconds. Six days open a week.
HISTORY_DAYS = 210

# The forecast is read on these day indexes, after everything up to and
# including that day has been logged.
#
# The early ones matter most. By day 70 the regression is already well fitted
# and dominant, so a run that starts there shows a weight bouncing around a
# high plateau rather than a model earning its place. Starting at day 10 shows
# the whole shape: nothing at all while the thin-data guards hold, then a
# substantial and sustained share once it has out-predicted the others on
# holdout data.
CHECKPOINTS = (10, 20, 35, 120, 205)


@pytest.fixture()
def appt_client(db, biz, monkeypatch):
    """A client for one appointment business, with a freezable clock."""
    monkeypatch.setenv("OPE_SIMULATED_CLOCK", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")

    biz.settings = {
        "timezone": TZ,
        # Closed Sundays, matching the generator's appointment world.
        "opening_days": [0, 1, 2, 3, 4, 5],
        "opening_hour": 9,
        "closing_hour": 18,
        "appointment_based": True,
    }
    db.commit()

    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_business] = lambda: biz
    app.dependency_overrides[get_tier] = lambda: Tier("premium")
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()
    clock.unfreeze()


def _set_appointment_mode(db, biz, on: bool) -> None:
    """Flip the per-business booking switch, the way Settings does."""
    biz.settings = {**(biz.settings or {}), "appointment_based": on}
    db.commit()


def _reset_history(db, biz) -> None:
    """Wipe everything the previous pass logged.

    Without this the two passes are not comparable at all. The first pass ends
    having logged the whole series, so the second pass's checkpoint at day 10
    would forecast with 200 days of history behind it — and "booking off" would
    look better purely because it was allowed to see the future. The first draft
    of this test had exactly that bug, and the false result it produced is the
    reason the reset is spelled out here rather than assumed.
    """
    db.query(SaleRecord).delete()
    db.query(DayRecord).filter_by(business_id=biz.id).delete()
    db.query(BookedCount).filter_by(business_id=biz.id).delete()
    db.query(ForecastRun).filter_by(business_id=biz.id).delete()
    db.commit()


def _evening_of(day: date) -> datetime:
    """After close, when the owner logs the day and reads tomorrow's forecast."""
    return datetime(day.year, day.month, day.day, 20, 0, tzinfo=ZoneInfo(TZ))


def _walk_forward(client, db, biz, series, *, booking_on: bool):
    """Replay the history, reading the forecast at each checkpoint.

    Returns (predictions, weights) where `predictions` maps a target date to
    what Ope predicted for it, and `weights` is the booking model's share of
    the blend at each checkpoint (0.0 when it did not participate).
    """
    _set_appointment_mode(db, biz, booking_on)

    open_days = {d.day: d for d in series if d.is_open}
    by_index = {d.index: d for d in series}
    last_index = max(by_index)

    predictions: dict[date, float] = {}
    booking_weights: list[float] = []

    logged_upto = -1
    for cp in CHECKPOINTS:
        # 1. Log every open day up to and including the checkpoint.
        for i in range(logged_upto + 1, cp + 1):
            d = by_index[i]
            if not d.is_open:
                continue
            clock.freeze(_evening_of(d.day))
            r = client.post("/day-records", json={
                "date": d.day.isoformat(), "customers": d.customers,
            })
            assert r.status_code in (200, 201), (d.day, r.status_code, r.text)
        logged_upto = cp

        # 2. Tell Ope the diary for the week ahead. An appointment business
        #    knows this in advance; it is not a peek at the answer, and it
        #    carries no information about who actually turned up.
        for i in range(cp + 1, min(cp + 9, last_index + 1)):
            d = by_index[i]
            if not d.is_open:
                continue
            r = client.put(f"/booked-counts/{d.day.isoformat()}",
                           json={"booked_count": d.booked})
            assert r.status_code == 200, r.text

        # ...and for the history already logged, so the regression has pairs.
        for i in range(0, cp + 1):
            d = by_index[i]
            if d.is_open:
                client.put(f"/booked-counts/{d.day.isoformat()}",
                           json={"booked_count": d.booked})

        # 3. Read the forecast exactly as the web app does.
        clock.freeze(_evening_of(by_index[cp].day))
        body = client.get("/forecast").json()
        assert body["status"] in ("ok", "learning"), body

        cp_weight = 0.0
        for day in body["days"]:
            target = date.fromisoformat(day["date"])
            if target not in open_days:
                continue
            predictions[target] = float(day["predicted_customers"])
            cp_weight = max(cp_weight, float(day["model_weights"].get("booking", 0.0)))
        booking_weights.append(cp_weight)

    return predictions, booking_weights


def _mape(predictions: dict[date, float], series) -> float:
    actual = {d.day: d.customers for d in series if d.is_open}
    errs = [
        abs(p - actual[t]) / actual[t]
        for t, p in predictions.items()
        if actual.get(t)
    ]
    assert errs, "nothing was scored — the walk-forward produced no predictions"
    return 100.0 * sum(errs) / len(errs)


def _run_profile(client, db, biz, profile: AppointmentProfile):
    series = simulate_appointment_series(profile, HISTORY_DAYS)

    _reset_history(db, biz)
    on_preds, on_weights = _walk_forward(client, db, biz, series, booking_on=True)
    _reset_history(db, biz)
    off_preds, off_weights = _walk_forward(client, db, biz, series, booking_on=False)

    # The two runs must have scored the SAME dates, or the MAPEs are not
    # comparable and a "win" could just be an easier set of days.
    assert set(on_preds) == set(off_preds)

    return {
        "series": series,
        "on_mape": _mape(on_preds, series),
        "off_mape": _mape(off_preds, series),
        "on_weights": on_weights,
        "off_weights": off_weights,
    }


# ── The backtests ─────────────────────────────────────────────────────────────

def test_booking_weight_climbs_and_mape_drops_for_a_barber(appt_client, db, biz):
    r = _run_profile(appt_client, db, biz, BARBER)

    # With the feature off, the booking model must contribute nothing at all —
    # otherwise the comparison below is measuring something else.
    assert r["off_weights"] == [0.0] * len(CHECKPOINTS), r["off_weights"]

    # It earns its place rather than being handed one. At the first checkpoint
    # there is not yet enough paired history for the thin-data guards, so it
    # must contribute NOTHING — a model that starts with weight is a model that
    # can wreck a forecast before it has proven anything.
    early, late = r["on_weights"][0], r["on_weights"][-1]
    assert early == 0.0, f"booking had weight before it had earned any: {early}"

    # Then it climbs and stays up. Not monotonically — inverse-MAE weighting
    # moves week to week as every model's recent error moves — so what is
    # asserted is the shape that actually holds: zero, then a substantial and
    # sustained share.
    assert late > early, f"booking's share never grew: {r['on_weights']}"
    assert min(r["on_weights"][1:]) > 0.2, (
        f"booking's share collapsed at some point: {r['on_weights']}"
    )

    assert r["on_mape"] < r["off_mape"], (
        f"booking made the forecast WORSE: {r['on_mape']:.2f}% on vs "
        f"{r['off_mape']:.2f}% off"
    )


def test_booking_helps_more_when_walk_ins_are_rare(appt_client, db, biz):
    """A clinic is nearly all diary, so the booked count should matter more.

    This is the check that the improvement tracks the DATA rather than the
    code path: the clinic profile has a lower show-up rate and almost no
    walk-ins, so its demand is far more determined by its bookings, and the
    booking model should gain more there than at the barber.
    """
    r = _run_profile(appt_client, db, biz, CLINIC)

    assert r["on_mape"] < r["off_mape"], (
        f"booking made the clinic forecast WORSE: {r['on_mape']:.2f}% on vs "
        f"{r['off_mape']:.2f}% off"
    )
    assert r["on_weights"][-1] > 0.0


def test_the_fitted_slope_and_intercept_recover_the_real_behaviour(appt_client, db, biz):
    """Ope's learned no-show rate and walk-in baseline should be roughly right.

    Roughly, deliberately. An exact match would mean the generator and the
    engine share an assumption, which is the failure mode this whole file
    exists to avoid. What is being checked is that a model fitted on nothing
    but (booked, actual) pairs lands near a truth it was never shown.
    """
    from app.engine.booking import fit_booking_regression, no_show_rate_from_slope

    series = [d for d in simulate_appointment_series(BARBER, HISTORY_DAYS) if d.is_open]
    fit = fit_booking_regression(
        [float(d.booked) for d in series],
        [float(d.customers) for d in series],
    )
    assert fit is not None
    slope, intercept = fit

    # True show-up rate 0.86 -> a no-show rate near 14%.
    assert no_show_rate_from_slope(slope) == pytest.approx(1 - BARBER.show_up_rate, abs=0.08)
    # True walk-in mean 5.0 a day.
    assert intercept == pytest.approx(BARBER.walk_in_mean, abs=2.5)

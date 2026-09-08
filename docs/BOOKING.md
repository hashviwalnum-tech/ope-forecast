# Booking-aware demand

For appointment businesses — barbers, spas, clinics — the diary is the single
best predictor of tomorrow, and no statistical model can see it. This is how Ope
uses it, what has been measured, and what is deliberately still to do.

Off by default. The owner turns it on with the `appointment_based` business
setting; nothing below happens until they do.

## The model

Booked load is a **floor**, not the whole demand: some bookings do not show up,
and some customers walk in without one. So:

```
predicted_total = show_up_rate x booked_count + walk_ins_per_day
```

Both numbers are **learned from this business's own history** by least-squares
regression over its (booked, actual) pairs — never hard-coded, never shared
between businesses. `app/engine/booking.py` holds the fit; it is a pure function
with no database and no framework, like the rest of the engine.

It earns its influence the same way every other model does: weighted by its own
holdout MAE per weekday (spec section 2). Under `MIN_BOOKING_PAIRS` paired days
it produces nothing at all and the forecast behaves exactly as it did before —
the same thin-data guard that stopped the `linear_trend` blow-up.

## Does it actually help? (measured, not assumed)

It shipped unproven — plausible, wired in, never checked against data. It has
been now: `backend/tests/test_booking_backtest.py`.

The data comes from an appointment business added to
`backend/tests/simulation/generator.py`, generated the way one actually works: a
diary is filled in advance, each booking independently turns up or does not
(binomial), and unbooked walk-ins arrive on top (Poisson). **The generator never
computes `slope x booked + intercept`** — the linear relationship Ope fits is an
emergent property of that process, not something handed over. The engine is
never told the show-up rate or the walk-in mean; recovering them is the test.

Two profiles, ~210 days each, walk-forward with the forecast read at five
checkpoints. The same history, the same target dates and the same requests run
twice — once with `appointment_based` on, once off — so the only difference is
whether the booking model may participate.

| Business | Booking off | Booking on | Change | Booking's share of the blend |
|---|---|---|---|---|
| Barber (86% show up, ~5 walk-ins/day) | 10.99% MAPE | **9.49%** | **−1.50pp** | 0 → 0.66, 0.51, 0.40, 0.53 |
| Clinic (72% show up, ~1 walk-in/day) | 25.48% MAPE | **18.39%** | **−7.09pp** | 0 → 0.85, 0.88, 0.61, 0.33 |

Two things worth reading off that table:

- **It earns its place from nothing.** At the first checkpoint the weight is
  exactly 0 — too little paired history for the guards — so the forecast is
  identical with the feature on or off. Only then does it climb.
- **The gain tracks the data, not the code path.** The clinic is nearly all
  diary and few walk-ins, so its demand is far more determined by its bookings —
  and booking helps it roughly five times as much. If the improvement were an
  artefact of the wiring, both would move together.

The weight does not climb *monotonically*; inverse-MAE weighting moves week to
week as every model's recent error moves. The shape that actually holds, and
what the test asserts, is: zero, then a substantial and sustained share.

### Keeping it honest

The rules from the simulation brief apply in full:

- the generator lives in `backend/tests/simulation/`, outside `backend/app/`;
- nothing under `backend/app/` imports it;
- no engine constant may be justified by a constant defined there;
- adding it changed **no existing simulation output** — `simulate_year()`
  produces a byte-identical series, verified by fingerprint.

One warning from building it, recorded because it produced a *false pass* first
time round. The initial backtest ran the "on" pass and then the "off" pass
against the same database without resetting, so the second pass forecast every
checkpoint with the whole series already logged — and "booking off" looked
*better*. A comparison that is not reset is not a comparison. `_reset_history`
exists for that reason and says so in its docstring.

## What the owner sees

`GET /booked-counts/model` reports what has been learned, and
`BookedCountsPanel` renders it in words: *"About 1 in 7 booked appointments
don't show up, plus roughly 5 walk-ins a day."*

`no_show_rate_from_slope` had existed with **no caller at all** — the number was
computed and thrown away. It reaches the owner now.

Before the fit exists the panel says it is **still learning**, with the count of
paired days so far. It does not round three days into a confident percentage;
that would be worse than silence, and it is how the first-fortnight forecast
already behaves.

## Whole-business total vs a partial per-service breakdown

A date can carry both a whole-business total and per-service counts for *some*
services. The per-service sum used to replace the total outright, so a spa with
30 booked and one "Massage: 8" entry told the forecast it had 8 appointments —
and the regression then fitted on a number that was not the day's booked load.

The rule now is the one the app already applies to hourly counts versus the
daily total (spec section 9): **the more detailed figure wins only when it is at
least as large.**

| Whole-business | Per-service sum | Used | Why |
|---|---|---|---|
| 30 | 8 (partial) | **30** | a partial breakdown never overrides the total |
| 12 | 16 | **16** | the breakdown is the fuller picture; the total was low |
| — | 16 | **16** | only one figure exists |
| 30 | — | **30** | only one figure exists |

Neither reading can lose bookings. Dates where a partial breakdown was set aside
are returned in `partial_service_dates` and shown to the owner, so they are told
which number the forecast believed rather than left to guess.

## Mobile

Reached parity: the setting, a booked-counts screen with per-service targeting
and the learned-rate card, and booked-vs-predicted under both the customer and
the per-service forecast. The Manage row appears only when the owner has said
they take appointments, matching the web tab. The strings were lifted verbatim
from the web i18n rather than translated a second time, so both front-ends say
the same thing in all fifteen languages. The backend needed nothing new.

Not yet seen on a phone — see [VERIFICATION.md](VERIFICATION.md).

## Deliberately not done yet

Noted, scoped, and left for later slices:

- **Calendar / POS auto-import.** Reading the diary straight from Google
  Calendar or a booking system instead of typing it. **Held pending a real pilot
  business** — building an integration before anyone has asked for it risks
  fitting an imagined workflow.
- **Booking-aware band widths.** The prediction interval is still built from the
  ensemble's residuals generally. On a day with a large known booked count the
  genuine uncertainty is narrower — most of the demand is already committed —
  and the band should reflect that.
- **Booking in onboarding and nudges.** An appointment business is never asked
  during setup whether it takes bookings, and the daily nudges never mention the
  diary ("tomorrow is heavily booked — consider extra help").

# Phase 0 — Setup, generator, and the noise floor

Status: **complete except the injectable clock, which is waiting on approval.**

---

## 1. Which database this test writes to

| | |
|---|---|
| Simulation DB | `backend/sim/sim.db` — a throwaway local **SQLite file**, created fresh by the harness |
| Production DB | Supabase Postgres, reached only via the `DATABASE_URL` env var set **in Render** |
| Local `.env` | **Does not exist** (`backend/.env` is absent), so nothing on this machine holds production credentials |
| Guard | The harness aborts before opening a connection if `DATABASE_URL` is not a `sqlite://` URL, or if it contains `supabase` / `postgres` / `render` |
| Git | `backend/sim/` added to `.gitignore` — the simulated DB is never committed |

**There is no path by which this test can reach the live database.** The production
connection string is not present anywhere on disk in this repo.

## 2. Simulated business

* Burger restaurant, **America/New_York**, currency USD.
* Open **09:00–17:00**, **closed Saturday**. Sunday open but low-traffic.
* Simulated year: **2025-08-01 → 2026-07-31** (365 days, 313 open days).
* Deliberately spans both US daylight-saving transitions:
  **2025-11-02** (fall back, inside the Halloween event *and* the overlapping ad)
  and **2026-03-08** (spring forward, inside the Spring coupon ad).
* Menu: 11 products — 4 burgers, 3 sides (one sold **by weight**, decimal units),
  2 drinks, 1 dessert, and 1 **service-type** product ("Birthday Party Package")
  which draws down three stocked consumables.
* Promo calendar: **11 ads and 11 events**, including a 7-day event, an ad that
  overlaps an event, and a Sunday-only ad. Both counts exceed the free tier's
  caps (5 ads / 10 events) so the limits get exercised.

## 3. Reproduction

```
seed              ope-nyc-burger-2025-v1
generator         backend/tests/simulation/generator.py
menu + similarity backend/tests/simulation/menu.py
noise floor       python -m tests.simulation.noise_floor   (from backend/)
```

The generator seeds a **separate RNG per day** derived from the master seed, so any
single day can be re-rolled thousands of times for Monte-Carlo work without
disturbing any other day. The year is bit-for-bit reproducible.

### Documented assumptions (the brief is ambiguous; both are recorded here)

* **A1 — percentages compose multiplicatively.** A "−10%" hit means ×0.90.
  Sunday can roll up to seven −10% hits; stacked *additively* that would reach
  −70% and make the series degenerate. Multiplicative is the standard reading of
  stacked percentage effects and keeps demand strictly positive.
* **A2 — "09:00–17:00" is eight serving hours 09…16.** That maps exactly onto the
  brief's two bands: shoulder = {9, 10, 11, 16}, peak = {12, 13, 14, 15}.

### Realistic messiness included (§6.7)

| Item | Detail |
|---|---|
| Forgotten days | 2025-09-28, 2026-03-02 — never logged (must be *absent*, never zero) |
| Late-logged days | 2025-12-01/02/03 and 2026-05-04 — backfilled 2–5 days after the fact |
| Anomaly days | 2026-02-05 (×0.22, burst water main) and 2026-06-02 (×2.35) — the owner marks these |
| Mid-year trend | +0.11 %/day compounding from day 180 → about **+23 %** by day 365 |

---

## 4. THE NOISE FLOOR — what "good" actually means here

This is the most important number in the whole test. Most of the variance the
brief specifies is **pure chance and cannot be forecast by anyone**. Grading Ope
against zero error would be dishonest.

The oracle knows the weekday, the promo calendar and the exact trend — but not
the individual random rolls, and not the one-off anomalies (nobody forecasts a
burst water main). Its best possible prediction is the conditional mean.

Evaluated over 285 open, logged, non-anomalous days from day 28 onward:

| | MAPE | MAD (customers) |
|---|---:|---:|
| **Noise floor** (best possible) | **7.67 %** | **38.7** |
| Baseline (a) — last week, same weekday | 15.93 % | 81.6 |
| Baseline (b) — trailing 4-week weekday mean | 12.34 % | 63.1 |

**So the bar is: Ope must beat 12.3 % MAPE to be worth anything at all, and
7.7 % is the theoretical best.** Anything in the 8–10 % band is genuinely good.
If Ope lands near or above 12.3 %, the forecasting adds nothing over arithmetic
a spreadsheet could do — and I will say so plainly.

### Per weekday (this predicts where Ope will look worst)

| Weekday | mean customers | floor | baseline (a) | baseline (b) |
|---|---:|---:|---:|---:|
| Monday | 554 | 7.21 % | 13.73 % | 10.13 % |
| Tuesday | 529 | 7.13 % | 16.72 % | 13.46 % |
| Wednesday | 547 | 7.82 % | 12.56 % | 9.81 % |
| Thursday | 542 | 6.53 % | 13.39 % | 10.76 % |
| Friday | 542 | 7.06 % | 12.75 % | 9.68 % |
| **Sunday** | **443** | **10.30 %** | 26.83 % | 20.38 % |

**Sunday is intrinsically the hardest day**, and by a wide margin. Its seven
sequential downward rolls give it a coefficient of variation of 14.6 % against
9.9 % on other days. When Ope forecasts Sundays worst, most of that is
irreducible — I must not "fix" the engine chasing it.

### Conditional demand levels the oracle uses

| Condition | expected customers (at base 500, no trend) | spread (sd) |
|---|---:|---:|
| Weekday, normal | 499 | 9.8 % |
| Weekday, during a promo | 570 | 7.3 % |
| Sunday, normal | 359 | 10.5 % |
| Sunday, during a promo | 534 | 5.9 % |

Note that promo days are *less* variable — suppressing the downward rolls removes
most of the spread. That is a genuine property of the brief's §6.5 rule.

---

## 5. Anti-self-deception controls in place (§4)

1. **Separation** — the generator lives in `backend/tests/simulation/`, entirely
   outside `backend/app/`. A test asserts no app module imports it.
2. **No peeking** — no engine change may cite a generator constant. Where I am
   tempted, it gets logged in `FINDINGS.md` as a finding instead of a fix.
3. **Fixed seed** — recorded above; the year is reproducible exactly.
4. **Noise floor computed before grading** — done, above.
5. **Naive baselines computed** — done, above.
6. **Honest reporting** — anything unverified is labelled "not verified".

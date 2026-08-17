# Ope — full-year simulated business test

**What this was.** A simulated burger restaurant in New York used Ope every day
for a year — 365 days, 311 logged trading days, about 164,000 customers and
422,000 items — entering everything through the app's own API, the same
endpoints the web client calls. Nothing was inserted into a database table and
no engine function was called directly to seed state.

**Seed** `ope-nyc-burger-2025-v1` · **Simulated year** 2025-08-01 → 2026-07-31 ·
**All numbers below are from that run.**

---

## 1. Verdict

**Not release-ready as it stood, and I would not have known that from the tests
alone.** Thirty-one distinct defects came out of this, and the serious ones only
appear when a real business uses the app for months: staffing advice inflated
3.5×, every free-tier limit silently unenforced after the trial, a forecast that
ignored the ads the owner had told it about, a home screen that grew to 55,000
characters, and an Insights page confidently stating something false.

**It is close now.** All 31 are fixed, the suite is at **669 passing with no
expected failures**, the year replays with **6 operational complaints** (down
from 82), the feature sweep across every screen returns **zero findings**, and
the forecasting genuinely beats both naive baselines.

**What is still not right — my honest list:**

1. **Sunday is the weak spot.** 15.8 % error against a floor of 10.3 %. Every
   other weekday is within 1.4–2.3 points of its floor; Sunday is 5.5 points off.
2. **Promo days remain the largest gap to the achievable.** 12.5 % against a
   floor of 4.3 %. Promo days should be the *easiest* days (the mechanism that
   makes them busy also makes them steadier), and Ope is at its worst on them.
3. **The forecast still runs about 15 customers low per day.** Much better than
   the +112 it started at, but the floor's bias is +3.3.
4. **The ensemble earns very little.** See §7 — this is a design finding, not a
   bug, and I think it matters more than any individual defect here.
5. **Nothing here tested a real deployment.** No Postgres, no Supabase auth, no
   Render, no mobile app, no billing. See §6.

---

## 2. Accuracy

Scored against the forecasts Ope **actually showed**, read back from the log the
simulated owner kept. 285 evaluation days: open, logged, past a 4-week warm-up,
with the two days the owner marked as flukes excluded.

### Next-day forecast — what an owner actually acts on

| | Error (MAPE) | Typically off by | Bias |
|---|---:|---:|---:|
| Noise floor — the best any forecaster could do | 7.19 % | 37.8 | +1.1 |
| **Ope** | **9.15 %** | **49.6** | +10.8 |
| Baseline (b): average of the last 4 same weekdays | 10.88 % | 58.7 | +5.3 |
| Baseline (a): same day last week | 14.01 % | 75.0 | +1.8 |

**Ope beats both baselines and lands within 2.0 points of the theoretical best.**

### Across the whole 7-day view

| | MAPE | MAD | bias |
|---|---:|---:|---:|
| Noise floor | 7.68 % | 38.8 | +3.3 |
| **Ope** | **10.20 %** | 53.3 | +14.7 |
| Baseline (b) | 12.42 % | 63.6 | +5.6 |
| Baseline (a) | 16.06 % | 82.3 | +1.1 |

### How it improved with more data

| | day 2 | day 60 | day 90 | day 180 | day 365 |
|---|---|---:|---:|---:|---:|
| Ope (next-day) | *range only* | 13.05 % | 10.13 % | 9.16 % | 9.15 % |
| Floor | — | 8.82 % | 7.01 % | 6.89 % | 7.19 % |
| Baseline (b) | — | 12.17 % | 10.00 % | 9.70 % | 10.88 % |

From **day 2** Ope shows a deliberately wide range labelled "still learning"
(built during this test — see F-014). It is not scored as a point forecast
because it does not claim to be one. Real accuracy arrives around day 60 and
essentially plateaus by day 180.

### Per weekday

| Weekday | mean/day | Ope | floor | baseline (b) | gap to floor |
|---|---:|---:|---:|---:|---:|
| Monday | 554 | 9.46 % | 7.21 % | 10.13 % | +2.3 |
| Tuesday | 529 | 9.29 % | 7.13 % | 13.46 % | +2.2 |
| Wednesday | 547 | 9.57 % | 7.82 % | 9.81 % | +1.8 |
| Thursday | 542 | 8.45 % | 6.53 % | 10.76 % | +1.9 |
| Friday | 544 | 8.71 % | 7.11 % | 10.17 % | +1.6 |
| **Sunday** | 443 | **15.79 %** | 10.30 % | 20.38 % | **+5.5** |

### Per product

Ope beats **both** baselines on **every single product**. Product-level demand is
far noisier than the customer total, so the absolute errors are much larger —
that is the nature of the problem, not a defect.

| Product | mean/day | Ope | baseline (a) | baseline (b) |
|---|---:|---:|---:|---:|
| Soft Drink | 304 | 14.70 % | 21.43 % | 15.85 % |
| Brownie Sundae | 95 | 13.57 % | 18.65 % | 15.25 % |
| Fries | 219 | 18.68 % | 25.73 % | 20.44 % |
| Veggie Burger | 75 | 27.87 % | 40.00 % | 30.65 % |
| Crispy Chicken Burger | 124 | 28.29 % | 38.01 % | 31.16 % |
| Coleslaw (sold by weight) | 21.6 | 29.66 % | 39.37 % | 32.92 % |
| Classic Beef Burger | 172 | 30.88 % | 44.19 % | 35.22 % |
| Double Beef Burger | 131 | 31.41 % | 41.62 % | 34.93 % |
| Onion Rings | 89 | 32.47 % | 42.24 % | 36.28 % |
| Milkshake | 121 | 35.06 % | 47.49 % | 38.30 % |
| Birthday Party Package *(service)* | 2.5 | 55.53 % | 87.75 % | 68.11 % |

### Per hour

The busy-hours profile is **accurate to 0.69 %** — essentially exact. (This is an
estimate of the usual shape, not a next-day forecast, and is scored as such.)

| Hour | Ope says | truth | error |
|---|---:|---:|---:|
| 9–10 | 63 | 62.4 | +0.9 % |
| 10–11 | 63 | 62.3 | +1.2 % |
| 11–12 | 63 | 62.6 | +0.7 % |
| 12–13 | 69 | 68.5 | +0.8 % |
| 13–14 | 69 | 68.8 | +0.3 % |
| 14–15 | 69 | 68.3 | +1.0 % |
| 15–16 | 69 | 68.6 | +0.6 % |
| 16–17 | 62 | 62.1 | −0.2 % |

### The prediction range

The actual landed inside the stated range **52.6 %** of the time, with a typical
width of 83 customers (16.5 % of the forecast). That is inside the ~50–68 % band
spec §6 deliberately asks for — but see the recommendation in §7.

---

## 3. Where the forecast was worst, and why

**Sunday (15.8 % vs a 10.3 % floor).** Two compounding causes. First, Sunday is
*intrinsically* the hardest day here: its seven sequential downward rolls give it
a coefficient of variation of 14.6 % against 9.9 % on other days, which is why
its floor is 3 points above every other day's. Roughly two-thirds of Sunday's
error is irreducible. Second, and this is the part that *was* fixable: a
promotion lifts a quiet day far more than a busy one, and a single pooled uplift
left **Sunday promo days under-forecast by 152 customers each (24.9 % error)**
while weekdays were nearly right. Fixed (F-020) by learning the uplift per
weekday; Sunday improved from 19.2 % to 15.8 %.

**Promo days (12.5 % vs a 4.3 % floor) — still the biggest gap.** Originally the
forecast **ignored tagged ads and events entirely**: it was low on *every single
promo day*, by an average of 112 customers, with a tracking signal of 8.0 against
a ±4 alarm threshold. It never once over-predicted. Tagged days are correctly
excluded from *training*, but nothing put the uplift back when forecasting a
future day the owner had already flagged. Since the ordering advice derives from
the same forecast, the shop was told to under-order on exactly the days it would
be busiest. Fixed (F-017, F-020), from 18.6 % to 12.5 % — but the floor is 4.3 %,
so there is still ~8 points on the table. The residual is a data problem: 22
promotions in a year is not much to learn per weekday, and the shrinkage
deliberately keeps the correction modest until it has earned more.

**After the trend shift.** Splitting the year at the point the business starts
growing:

| | bias | MAPE |
|---|---:|---:|
| ordinary days, flat period | **−1.5** | 9.55 % |
| ordinary days, growth period | **+19.9** | 9.51 % |

Before growth, essentially unbiased. During growth, ~20 customers low *every
day*. Diagnosed as structural (F-019): **inverse-error weighting is blind to
bias**, so when demand grows every trailing-average model is low in the same
direction and they all keep similar error magnitudes — the blend simply inherits
the lag. Partly fixed by shifting each model by its own measured bias, but only
where the evidence is statistically solid; see §7 for why I did not push harder.

**Shoulder hours vs peak hours** turned out not to be a source of error at all —
the hourly profile is accurate to 0.69 %. The hourly problems were bugs (units
counted as customers, UTC bucketing), not forecasting weaknesses.

---

## 4. Feature-by-feature results

Every surface, on a business with a full year of history. Details in
`docs/simulation/feature_sweep.txt`.

| Area | Result |
|---|---|
| Onboarding, settings, opening hours, closed days | **Works.** Closed Saturdays excluded everywhere; opening hours respected by every hourly surface |
| Product CRUD — stocked and service | **Works.** Service never offered for reorder |
| Units, whole vs decimal | **Works.** Coleslaw by weight throughout; customers always whole |
| Service consumables | **Works.** Draw-down applied; silent when none configured |
| Tap logging (live capture) | **Works** — after 4 fixes. This path had the worst bugs |
| End-of-day totals, hourly backfill, backfill screen | **Works** |
| Tap-day roll-up into Past Days | **Fixed** (F-013): Past Days was empty for a tap-only owner |
| Forecast: weekday, per product, total | **Works.** §2 |
| Ensemble re-weighting | **Works, but earns very little.** §7 |
| Early forecast from day 2 | **Built during this test** (F-014) |
| Hourly / monthly premium forecasting | **Works.** Hourly accurate to 0.69 % |
| Ordering: reorder point, safety stock, capacity, shelf life, lead time | **Works** — after F-023 and F-024 |
| Batch FIFO and spoilage | **Works** |
| Order lifecycle, arrival confirmation | **Fixed** (F-027): a year of deliveries listed as "in transit" |
| Staffing, busy hours, queueing, marginal worker | **Works** — after F-009, F-010, F-025. Was 3.5× wrong |
| Ad/event lift, incl. the overlapping pair and Sunday-only ad | **Works.** 20 of 22 measured; both halves of the overlapping pair measured separately |
| Recurring patterns | **Works** |
| Anomaly marking, fluke exclusion | **Works** — after F-007 |
| Regulars + CLV + profitability + churn | **Works.** CLV, month/year/all-time revenue, per-regular chart |
| Change detection / drift alerts | **Fixed** (F-021): fired 65 times a year and never cleared; now 5 |
| Accuracy metrics (MAD, MSE, MAPE, tracking signal) | **Fixed**: was scoring one model, not the blend |
| Insights | **Works** — after F-028, which was stating something false |
| Monthly trends / history | **Fixed** (F-029): hid 55 real trading days |
| Smart planning toolbox | **Not verified** — see §6 |
| Premium: multiple locations, copy settings not data | **Works** — after F-016 |
| Premium: extended history, extra ads, hourly/monthly | **Works** |
| **Free limits actually binding** | **Fixed** (F-018) — they were *all* unenforced |
| Auth and per-business isolation | **Works.** A second account sees nothing; forcing another business's id returns 404 |
| Timezone / DST | **Fixed** (F-001…F-004, F-011, F-012). Year spans both DST transitions |
| i18n across 15 languages, RTL | **Works** — after an audit and 5 fixes |
| Dark mode | **Works** across all screens and charts |
| Error messages for a non-technical owner | **Works.** Plain language; friendly "Couldn't reach the server / Retry" rather than a crash |

---

## 5. Every bug found

Full detail, root cause and fix for each is in
[`FINDINGS.md`](FINDINGS.md). Summary — **32 findings, 31 fixed**:

**Severity 1 — wrong numbers shown to the owner (13):** staffing inflated 3.5×
by counting items as customers · per-item service time used as per-customer ·
"today" being the server's date, not the shop's (20 call sites) · live taps
stamped with server-local time · entry-timing double-converting the clock ·
orders locking 4 hours early · Insights bucketing hours in UTC · product taps
bucketed by UTC day · the forecast ignoring tagged ads and events · a single
promo uplift wrecking Sundays · the forecast lagging a growing business · every
free-tier limit unenforced after the trial · future-dated days accepted and
silently corrupting both training data and stock · the ordering card listing a
year of deliveries as in-transit · Insights reporting growth as seasonality.

**Severity 2 — broken or misleading (12):** Past Days empty for tap-only owners
· no forecast at all for the first two weeks · outlier detection pestering
steady businesses · "order now — quantity 0" · ordering advice in English
regardless of language · location copy turning services into stocked goods ·
hourly backfill destroying product taps · drift alert as permanent wallpaper ·
Accuracy scoring one model instead of the blend · Insights scoring the
7-day-ahead forecast · Monthly Trends hiding 55 trading days · dates and money
following the browser's language, not the app's.

**Severity 3 (6):** deprecated `utcnow` · closed weekdays reported as "0.0
customers on average" · two screens naming different peak hours on a near-tie ·
"Saving…" shown while loading · 5 tests already failing on `main` before this
started · `npx tsc --noEmit` silently type-checking nothing at all.

**Unfixed (1):** F-006 — `backfill-hourly` deletes every sale event for the day,
including product taps, so an owner who tapped products and later backfilled
corrected hourly counts from their register loses that day's product breakdown.
**Now reproduced:** 36 burgers and 22.5 portions of fries vanished silently while
the customer count was corrected as intended. Reachable from the *Add Past Day*
form and the CSV importer, so a CSV with hourly columns wipes the product detail
of every day it covers. Left unfixed because the fix is a product decision, not a
correction — narrowing the delete stops the data loss but leaves stale product
rows behind on a genuine re-import, and choosing between silent deletion and
silent staleness is the owner's call. **It should be settled before beta.**

---

## 6. Not verified

Stated plainly, because these are real gaps in what this test proves:

* **Anything about the actual deployment.** The whole test ran against local
  SQLite with the auth layer replaced. **Postgres, Supabase authentication, Row
  Level Security, Render, and Vercel were never exercised.** Several fixes here
  touch code that behaves differently on Postgres (date comparisons, JSON
  columns). This test cannot tell you the deploy is healthy.
* **The mobile app.** Type-checked only. Never run on a device in this work.
* **Billing and payments.** No processor is wired up. The premium *gating* is
  now verified; the *paying* is not.
* **The smart planning toolbox** (§7.5 of the spec). Never opened.
* **The guided tour and onboarding wizard.** The tour was seen auto-launching
  and dismissed; not walked through.
* **CSV import**, including the data-corruption bug the spec describes. The
  simulated owner used the API and the tap screen, never the importer.
* **Telegram bot and nudges.** The nudge endpoint answers; no message was sent.
* **Accessibility beyond translated labels.** There is no axe or Playwright
  suite in this repo to run.
* **Load and concurrency.** One business at a time, sequential requests.
* **F-006** above.

I also cannot claim the forecasting numbers generalise beyond this business
shape. They describe one high-volume, weekday-heavy restaurant with one quiet
day and a growth trend.

---

## 7. Honest recommendations

**1. The ensemble is the least valuable part of the forecasting engine, and it
has the most prominence.** Measured over the year: the four models' true skill
spanned only 65.3 to 70.5 MAE — a 7.9 % spread. They are four ways of averaging
the same day-of-week history and they largely agree. The re-weighting was worth
**0.02 percentage points** against splitting the vote evenly. Worse:
**seasonal-naive alone scored 12.98 % where the four-model blend scored 13.14 %**
— blending was *worse* than using the single best model, because the weakest
model kept a quarter of the vote. Even perfect hindsight model-selection per
weekday would only reach 12.67 %.

I fixed the mechanism so it actually reacts (F-026), and it now costs nothing and
improves the prediction range. But **do not build more models expecting more
accuracy.** Every point of real improvement in this exercise came from
*context* — knowing an ad is running, knowing the business is growing, knowing
Sunday responds differently — not from better averaging. That is worth knowing
before investing in ARIMA or self-tuning meta-weights, both of which are on the
roadmap and both of which are more of the same.

**2. The value is in the decisions, and the decisions were where the damage
was.** The forecast was never catastrophically wrong. The *staffing* was wrong
by 3.5×, the *ordering* under-ordered on every promotion, the *alerts* cried wolf
65 times, and the *limits* gave away the product. Spec §1.6 already says the
durable value is "decisions and change-detection, not the prediction itself" —
this test is strong evidence for that. I would put engineering effort there.

**3. Reconsider the prediction range.** It behaves exactly as designed (52.6 %
coverage, matching the ~50–68 % target), which means **the real number falls
outside the stated range every other day.** A non-technical owner shown "Tuesday:
520–600" and getting 615 will conclude the app is wrong, not that they are
reading a 50 % band. Either widen it to ~80 % or label it far more explicitly
("about half of days land in here"). This is a design decision, not a bug, and I
think the current choice will cost you trust.

**4. Ordering advice replenishes to the reorder point but never above it.** The
suggested quantity is demand-over-lead-time plus safety stock, which restores
stock *to* the trigger level. Combined with a storage cap below the reorder point
(Milkshake: 400 capacity, 475 reorder point), a shop can sit permanently at or
below its trigger no matter how diligently it orders. Ope now explains this
rather than saying "order now: 0", but the underlying policy is worth revisiting
— an order-up-to-target policy would be more robust.

**5. The trial-to-free transition was giving the product away, and that class of
bug will recur.** The tier was a cached flag refreshed only when the client
happened to ask. Anything that gates on state the *client* is responsible for
refreshing will leak. Before billing goes live, I would audit every limit check
for this pattern specifically.

**6. Two screens should never compute the same number differently.** Three
separate surfaces reported three different "accuracy" figures (13.7 %, 11.2 %,
and a true 10.2 %), and two named different peak hours. Each was individually
defensible and collectively they destroy confidence. The stored `ForecastRun`
table is the single honest source for "how did we do" and was going unused.

**7. Test with a *long-lived* account, not just a fresh one.** Five of the worst
findings — the in-transit wall, the permanent drift alert, the unenforced limits,
the growth-as-seasonality claim, the hidden trading days — are invisible on a
two-week-old account and unavoidable on a one-year-old one. The existing test
suite is good and caught none of them.

**8. The tooling gap is fixed, but check for others like it.** `npx tsc --noEmit`
was exiting 0 without checking anything at all — a solution-style `tsconfig.json`
type-checks zero files outside build mode. A green check that verifies nothing is
more dangerous than no check, because people trust it. It is worth asking of every
gate in this project: if I deliberately break something, does it actually go red?

---

## 8. Reproducing this

```
seed                 ope-nyc-burger-2025-v1
simulated year       2025-08-01 → 2026-07-31  (365 days, 311 logged)
database             backend/sim/sim.db — local SQLite, gitignored;
                     the harness refuses to start against anything else

# from backend/
python -m tests.simulation.noise_floor      # the floor and naive baselines
python -m tests.simulation.run_year --to 365 --quiet
python -m tests.simulation.score            # accuracy vs floor and baselines
python -m tests.simulation.score_detail     # per product, per hour
python -m tests.simulation.feature_sweep    # every screen, on a year of data
python -m tests.simulation.analyse_weights  # the ensemble investigation
python -m tests.simulation.serve_sim        # serve it for a browser pass

OPE_SIM_NO_DEBIAS=1 python -m tests.simulation.run_year --to 365   # A/B control
```

The generator seeds a separate RNG per day from the master seed, so any single
day can be re-rolled thousands of times without disturbing another — that is how
the noise floor is computed, and it makes the year bit-for-bit reproducible.

**Anti-self-deception controls** (the same agent wrote the answer key and the
thing being graded): the generator lives outside `backend/app/` and a test fails
if any application module imports it; the noise floor and both baselines were
computed *before* anything was graded; no engine change cites a generator
constant; and where a fix could not be justified from observable data alone it
was recorded as a finding instead. Two engine changes were validated by running
the entire year twice, with and without them, on identical data — one of which
proved my first attempt made accuracy *worse*, and was rewritten.

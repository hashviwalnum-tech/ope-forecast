# FINDINGS — full-year simulation test

Running log. Every entry: **what broke → why → how it was fixed** (or why not).
Newest phase last.

Severity: **S1** wrong data / wrong numbers shown to the owner · **S2** feature
broken or misleading · **S3** confusing or cosmetic.

---

## Phase 0 — code audit (found by reading, before any data was written)

These came out of the §3 requirement to report every hard-coded `datetime.now()`
/ `date.today()` that bypasses a clock. They are **live production bugs**, not
artifacts of the test. All are confirmed by reading the code; none is fixed yet.

### F-001 · S1 · "Today" is the *server's* date, not the business's date
`app/api/analytics.py` (lines 319, 742, 1079, 1191, 1467, 1868),
`app/api/day_records.py` (129, 130, 283, 292), `app/api/products.py` (58, 79),
`app/api/regulars.py` (26, 121, 156), `app/api/dev_catchup.py` (186, 325).

All call bare `date.today()`. Render runs in **UTC**. For a New York business
(UTC−4/−5) the server rolls over to "tomorrow" at **19:00–20:00 New York time**,
i.e. while the restaurant is closing. During that window the 7-day forecast, the
ordering recommendation, the history cutoff, the insights page and the regulars
screen are all computed for the **wrong day**.

The mirror-image bug hits the existing Israeli users: Asia/Jerusalem is UTC+2/+3,
so between local midnight and 02:00/03:00 the server still thinks it is
*yesterday* — the "log today's totals" gate and the forecast are a day behind.

Correct behaviour: every "today" must be the business's local date, derived from
`biz.settings["timezone"]` (the helper `utc_to_local_date` already exists and is
used correctly in three places — it is simply not used in these twenty).

### F-002 · S1 · Live taps are stamped with naive server-local time
`app/api/sale_events.py:51` — `timestamp=datetime.now()`.

Every other read path (`utc_to_local_hour`, `utc_to_local_date`,
`local_day_utc_bounds`) treats a stored naive timestamp as **UTC**. The write
path stores **server-local** time. These agree only because Render happens to run
in UTC — `app/engine/live_sales.py:36` even documents the assumption in a
docstring. Any deployment on a non-UTC host silently shifts every tap into the
wrong hour bucket, corrupting busy-hours, staffing and the hourly forecast.

Correct behaviour: `datetime.now(timezone.utc)`, matching every other writer.

### F-003 · S1 · Entry-timing check converts local time as if it were UTC
`app/api/day_records.py:130` — `utc_to_local_hour(datetime.now(), tz_name)`.

`datetime.now()` returns a **naive local** time which `utc_to_local_hour` then
treats as UTC and converts again. On a UTC server this is accidentally right; on
a developer machine in Israel it is off by three hours, so "your business is
still open, log after you close" fires at the wrong time.

### F-004 · S1 · Orders lock hours too early for a non-UTC business
`app/api/orders.py:42` — `datetime.now() >= closing_dt`, where `closing_dt` is
built from the business's **local** `closing_hour` but compared against the
**server's** clock. For a New York restaurant closing at 17:00, the UTC server
passes 17:00 at **13:00 New York time** — so "I ordered this" becomes
uneditable four hours before the shop closes, silently breaking the documented
"editable until closing hours" rule.

### F-005 · S3 · `datetime.utcnow()` is deprecated
`app/api/analytics.py:827`. Works, but deprecated since Python 3.12 and will
warn/break on a future runtime. Should be `datetime.now(timezone.utc)`.

### F-006 · S2 · Hourly backfill destroys same-day product taps — **REPRODUCED, still unfixed**
`app/api/sale_events.py:81-85` — `backfill_hourly` deletes **every** SaleEvent in
the day's window, then re-inserts one customer-count row per hour with
`product_id=None`. An owner who tapped products during the day and later
backfilled corrected hourly customer counts from their register loses the entire
product breakdown for that day.

**Now reproduced end to end** (it was flagged from reading during Phase 0 and
verified afterwards). Tapping 45 customers, 36 burgers and 22.5 portions of fries
on one day, then submitting corrected hourly counts for that same day:

```
after tapping        : {'Burger': 36.0, 'Fries': 22.5} | customer taps: 45
after backfill-hourly: {}                              | customer taps: 48
```

The customer count is corrected as intended; **the entire product breakdown is
silently gone.** No warning, no confirmation, nothing in the response to say
anything was removed.

**Reachable from two UI paths**, not just the API: the *Add Past Day* form
(`BackfillForm.tsx:152`) and the CSV importer (`CsvImport.tsx:299`) — so a CSV
with hourly columns wipes the product detail of every day it covers.

**Why it is still unfixed:** it is the only finding whose fix is a genuine
product decision rather than a correction. The endpoint's "replace everything for
this day" behaviour is what makes re-submitting a corrected import safe and
idempotent, which is deliberate and valuable. Narrowing the delete to only
customer-count rows (`product_id IS NULL`) fixes the data loss, but then
re-importing a day whose product figures also changed leaves the old product rows
behind — trading silent deletion for silent staleness. Choosing between those is
the owner's call about how import should behave, not a bug fix.

**Ship assessment: this one should be fixed before beta.** It silently destroys
data the owner deliberately entered, on a path the app actively encourages
(tap during the day, tidy up from the register later), and the mitigation is
narrow (`DELETE … WHERE product_id IS NULL`) plus telling the owner what is about
to be replaced.

### F-007 · S2 · Outlier detection pesters a very steady business — **open**
`app/engine/outliers.py`.

Tukey fences are **scale-free**: they flag anything outside 1.5×IQR regardless of
whether that distance matters in the real world. A café whose Mondays run 98–103
customers has an IQR of about 1.5, putting the upper fence at 103 — so an utterly
ordinary Monday of **104** gets flagged as unusual. Spec §6 explicitly forbids
firing on ordinary fluctuation, and this is the same class of complaint that
produced the original "43 flagged against a ~54 average" bug report.

Captured as a strict `xfail` test (`test_very_steady_business_is_not_pestered`)
so the moment it is fixed the test flips and says so. **Deliberately not fixed
yet** — the right fix (a practical-significance floor alongside the fence) should
be chosen from how often it actually misfires on the simulated year, not invented
from a synthetic example. Note the simulated burger restaurant has ~10 % daily
variation, so it may well never trip there; the exposure is to genuinely steady
businesses.

### F-008 · S3 · Five tests were already failing on `main` — **fixed**
The test suite was **not green** before this work started: 5 failures, 560 passes.
Two independent causes, neither an app regression:

* **Four in `tests/engine/test_outliers.py`.** They feed 5 same-weekday
  observations, but `MIN_SAME_WEEKDAY` is 6, so `detect_outliers` correctly
  returned nothing and the assertions failed. The threshold was raised at some
  point without updating the tests. *Fixed* by extending each dataset to 6+
  same-weekday points and recomputing the known-answer fences by hand; added
  `test_min_same_weekday_threshold_is_enforced` so the guard can't be silently
  loosened. The §12 known-answer IQR test also had an arithmetic error in its own
  docstring (it claimed Q3 = 137.5 for a set where numpy gives 127.5) — corrected.
* **One in `tests/test_day_records.py`.** It hard-coded absolute dates
  (`2025-08-01`…) which have since aged past the free tier's 365-day history cap,
  so the endpoint correctly returned 403. A time bomb, not a bug. *Fixed* by
  making the dates relative to today.

Suite is now **566 passed, 1 xfailed** (the xfail being F-007). `tsc --noEmit`
clean and `npm run build` succeeds.

---

## Phase 1 — first 14 simulated days

Setup: the owner **taps every sale live** for two weeks — 550-ish taps a day
through `POST /sale-events`, at the real simulated hour each sale happened.
This is the live-capture path, and it turned out to be where the worst bugs were.

### F-009 · S1 · Staffing advice was inflated ~3.5× — it counted items, not customers — **FIXED**
`app/engine/live_sales.py: hourly_averages`.

`hourly_averages` summed the **quantity of every SaleEvent** to get the hourly
arrival rate λ. But a customer who buys a burger, fries and a drink generates
four events. So an hour that genuinely saw **60 customers was reported as 211
arrivals**, and Ope told a burger restaurant to **"schedule 13 people"** for a
9–10am hour. Verified against the simulated truth: reported 211/211/208/226/229/
238/224/212 against actual 59.7/57.9/57.8/63.9/64.3/66.0/63.2/59.0 — exactly
customers + units, in every hour.

This affects **every business whose customers buy more than one item**, i.e.
essentially every café, restaurant and shop. It corrupted the busiest-hour chart,
the peak-hour insight, expected wait times, queue lengths, and every
"what if I add a worker" comparison.

*Root cause:* `rollup_tap_days` already knew the right rule — customer-arrival
taps are the ones with `product_id IS NULL`, with a fallback to counting tap
events for a product-only tapper. `hourly_averages` never applied it, so the
daily view and the hourly view disagreed about the same day.

*Fix:* new pure function `customer_arrivals_by_day_hour()` applying exactly that
rule, decided **per day** so a business can change tapping habits mid-history.
`hourly_averages` now returns customers. After the fix Ope reports
60/58/58/64/64/66/63/59 — the true numbers — and staffing drops to 10–12 for a
60-customer hour that costs ~8 staff-minutes per customer.

### F-010 · S1 · Service time was a per-*item* average used as a per-*customer* time — **FIXED**
`effective_service_time` averaged the service times of the items in the mix. A
customer ordering a burger (6 min), fries (2 min) and a drink (1 min) came out
at **3 minutes** — the mean of the three — when that customer actually occupies
staff for **9 minutes**. The queue model needs time-per-customer, so this
understated the work by the basket size, partially masking F-009.

*Fix:* new `service_minutes_per_customer()` = total work in the hour ÷ customers
in the hour, falling back to the business default when there is no product
detail. Known-answer tests pin both the sum-the-basket rule and the fallback.

### F-011 · S1 · The Insights page bucketed hours in UTC — **FIXED**
`app/api/analytics.py` (insights). It used `e.timestamp.hour` raw, while every
other hourly surface converts with `utc_to_local_dt`. For the New York
restaurant, Insights reported the busiest hour as **4–5pm when it was actually
12–1pm** — off by exactly the UTC offset. Worse, the opening-hours filter was
then applied to UTC hours, so it silently analysed the wrong slice of the day.
Two screens gave different answers to "when am I busiest".

*Fix:* convert to the business's local clock first. Insights and
`/hourly-analytics` now agree exactly (peak 2–3pm at 66.0, quietest 11–12 at 57.8).

### F-012 · S1 · Product taps were bucketed by UTC calendar day — **FIXED**
`app/api/analytics.py` (product forecast) used `se.timestamp.date()`, so an
evening sale in New York (after 20:00 local = past UTC midnight) counted toward
the **next** day's product demand. Now uses the business's local date.

### F-013 · S2 · Past Days was empty for an owner who only taps — **FIXED**
`GET /day-records` never called `rollup_tap_days`. Spec §9 says tap-only days
roll into past days automatically after closing; in practice that only happened
as a side effect of visiting an *analytics* screen. An owner who tapped all week
and then opened Past Days to check their numbers found nothing there. Now the
Past Days endpoint performs the roll-up itself.

### F-014 · S2 · A new owner saw "not enough data" everywhere for two weeks — **FIXED (feature)**
Confirmed by running it: for the first 14 days, `/forecast`, `/accuracy` and
`/ordering` all returned "not enough data". That is the worst possible first
fortnight — the owner is doing the work and getting nothing back, right when
they are deciding whether the app is worth the effort.

*Built:* a deliberately humble early forecast, live from the **second logged day**.
New pure function `early_forecast()` in `app/engine/forecasting.py`:
* no same-weekday history yet → the average of everything logged so far;
* some same-weekday history → the same-weekday average **shrunk toward** that
  overall average with weight `k/(k+1)`, so one quiet opening Sunday cannot
  anchor every future Sunday;
* the band is the spread of all logged days, widened by the small-sample factor
  `√(1+1/n)` at z = 1.0 — visibly wider than the mature ±0.7σ band, because the
  uncertainty genuinely is larger; a flat history still yields ±25 % rather than
  a fake-precise single value.

`/forecast` returns `status: "learning"` with `days_logged` / `days_needed`. The
web panel now draws the chart in this state, above a calm amber "Still learning —
day 9 of 14" note, and lists **the range for each day** underneath so the range
is what the owner reads, not the midpoint. Ten known-answer tests. All copy went
through the translation system in **all 15 languages** (no new hardcoded strings).
The **ordering recommendation deliberately stays gated** at the full 14 days — a
rough range is useful, a wrong order quantity costs real money.

### F-015 · S3 · Closed weekdays were reported as "0.0 customers on average" — **FIXED**
`/weekday-averages` emitted every weekday, so the restaurant's closed Saturday
came back as `avg_customers: 0.0, n_observations: 0` — the missing-day-is-not-zero
rule leaking into an API response, and it reads as "you serve nobody on Saturdays".
Weekdays with no observations are now omitted. (Note: this endpoint is currently
called by neither the web nor the mobile client — it is dead surface area, which
is worth deciding about separately.)

### F-016 · S2 · Copying a location turns services into stocked products — **found by reading, not yet verified**
`app/api/businesses.py: copy_business` copies a fixed field list that omits
`product_type` and `is_favorite`. A "Birthday Party Package" service copied to a
new location should stay a service; instead it lands as a `stocked` product (the
column default) with no lead time. To be confirmed when premium multi-location
is exercised in Phase 3.

**Phase 1 result:** after the fixes, the 14-day run completes with **zero issues
recorded**, every tapped day rolls up to exactly the right customer count, the
hourly chart matches the simulated truth hour for hour, and a forecast is
available from day 2. Suite: **599 passed, 1 xfailed**; `tsc` clean; web builds.

## Phase 2 — days 15–90

The owner switches to what a 500-cover restaurant actually does: hourly counts
from the register, then the day's totals and per-product units after closing.
Every forecast Ope made was written down with the date it was made, and scored
afterwards against the noise floor and the two naive baselines.

### The headline number

At day 90, over 52 scored days (past the 4-week warm-up, the two marked flukes
excluded), scoring the freshest forecast Ope was showing for each date:

| | MAPE | MAD | bias |
|---|---:|---:|---:|
| **Ope** | **11.09 %** | 53.7 | **+15.7** |
| noise floor (best possible) | 7.45 % | 35.2 | +5.5 |
| baseline (a) last week, same weekday | 15.63 % | 75.3 | +0.7 |
| baseline (b) trailing 4-week weekday mean | 11.73 % | 55.8 | +3.5 |

Ope beats both baselines — but **only just** beats the trailing-4-week mean
(11.09 % vs 11.73 %), and sits 3.6 points above the floor. It is also
**biased low by 15.7 customers a day**, where the floor's bias is +5.5.

### F-017 · S1 · The forecast ignored ads and events the owner had already tagged — **FIXED**

The bias has one dominant cause, and it is a big one.

| | n | MAPE | bias |
|---|---:|---:|---:|
| normal days | 44 | 10.01 % | **+0.2** |
| promo days | 8 | 18.63 % | **+112.0** |

On normal days Ope is essentially unbiased. On days the owner had tagged as an
ad or event it was low by **112 customers on every single one** (MAD equals the
bias exactly — it never once over-predicted), with a tracking signal of 8.0
against the ±4 alarm threshold.

*Root cause:* tagged days are excluded from the training baseline — correct, so
the models learn what a normal day looks like. But nothing ever added the uplift
back when forecasting a **future** day the owner had already told us a promotion
was running on. The owner types in "Halloween week, 30 Oct–5 Nov" and Ope
forecasts those days as if nothing were happening. The ordering advice is
derived from the same forecast, so the shop is told to **order too little on
precisely the days it will be busiest** — the worst possible time to run out.

*Fix:* new pure module `app/engine/promo_uplift.py`. The uplift is learned from
the business's **own completed promotions** — the same actual-÷-baseline ratio
the Lift screen already shows the owner, so the two can never disagree. It is
shrunk toward 1.0 with weight `(Σratios + 1)/(n + 1)`, so the first promotion a
business ever runs is treated as weak evidence rather than gospel; ratios are
clamped to 0.5–2.0 so one freak period cannot dominate; **with no promo history
the uplift is exactly 1.0 and the forecast is untouched.** An ad overlapping an
event takes the *larger* of the two uplifts, never their product. Twelve
known-answer tests.

**Honest caveat:** at day 90 there were only a handful of *finished* promotions
to learn from, so the improvement by then is small (promo MAPE 18.63 % → 17.07 %).
That is the design working as intended — it earns its influence — but it means
the feature is only properly tested over the full year. Re-measured in Phase 3.

### F-018 · S1 · Every free-tier limit stopped applying once the trial ended — **FIXED**
`app/api/deps.py`, `app/api/businesses.py`.

Creating a business starts a 30-day trial and writes
`settings["tier"] = "premium"`. Every server-side limit check reads that flag.
The **only** thing that ever wrote it back down was the client calling
`GET /subscription`.

So a user who never opened the premium screen — or any API-only caller, such as
the Telegram bot — kept **unlimited locations, unlimited ads, unlimited events
and unlimited history, permanently**, long after their trial expired. Spec §10
requires "limit checks read live tier"; they read a cached copy refreshed only
at the client's discretion. Written up as seven failing tests before the fix:
all four limits were confirmed unenforced, and `GET /businesses/me` still
reported `tier: "premium"` a month after expiry.

*Fix:* `sync_user_tier()` resolves the tier from the Subscription and writes it
onto the user's businesses, called on every scoped request (`get_business`) and
on the three endpoints that check limits without it (`create_business`,
`copy_business`, the business list). The admin tier override now records
`tier_admin_override` so a deliberate manual grant is not reverted by the sync.
Nine tests now cover: trial grants premium; expiry revokes it **without the
client asking**; ad, event and history caps all bind; ads and events have
separate allowances; and upgrading lifts the location limit at runtime.

### F-016 · S2 · Copying a location turned services into stocked goods — **FIXED** (was "not yet verified")
`copy_business` wrote a fixed field list omitting `product_type`, `is_favorite`
and the service→consumable links. A spa's "60-minute Massage" copied to a second
branch arrived as a **`stocked` product with no lead time** — an invalid product
the new branch would then be prompted to reorder — and the oil it draws down was
silently forgotten, so the new branch tracked no stock for it. Fixed, with five
tests covering type, all product settings, consumable links pointing at the new
location's products, stock/history NOT being copied, and free accounts blocked.

### Observations (not bugs, but worth deciding about)

* **The self-correcting weights barely correct anything.** Averaged over the
  scored days the ensemble sat at seasonal-naive 0.28, exponential smoothing
  0.26, weighted-moving-average 0.26, linear trend 0.20 — very nearly a plain
  four-way average. Inverse-MAE weighting can only differentiate models whose
  errors differ, and on this business all four are close. The mechanism is
  sound; the marketing claim that Ope "learns which method works for you" is
  doing more work than the maths is.
* **The prediction band behaves exactly as designed, which may still surprise
  owners.** The actual landed inside the band 50.0 % of the time, with a typical
  width of 71 customers (14.6 % of the forecast). That is the deliberate
  "probable range, not possible range" choice in spec §6 — but it does mean the
  real number falls outside the stated range every other day.

## Phase 3 — days 91–365 (the full year)

The full 365 simulated days, with the owner also placing every reorder Ope
recommended, recording four regulars' visits, teaching Ope a recurring Friday
lunch pattern, tagging all 22 promotions, and reviewing every day Ope flagged.

The first full-year run finished with **82 operational complaints**. Two
patterns accounted for all of them.

### F-021 · S2 · The drift alert became permanent wallpaper — **FIXED**
`app/engine/accuracy.py: detect_drift`.

The identical alert — *"Your demand has been ~11.3 % higher than usual over the
last 3 weeks"* — fired on **65 separate days** and never once cleared.

*Root cause:* it compared the last three weeks against **all of history**. That
answers "are you different from your all-time average", which for any growing
business is permanently yes. The simulated restaurant grows about 0.1 % a day
from mid-year; within weeks the recent mean is >10 % above the lifetime mean and
stays there forever. An alarm that is always on is not an alarm — the owner
learns to ignore it, and a genuine shift then goes unnoticed.

*Fix:* compare the recent window against the **window immediately before it**,
which is the question the owner actually cares about — *has something changed
lately?* Steady growth barely registers between adjacent windows (that belongs
on Insights as a trend, not as a warning), while a real step change still fires
and then correctly goes quiet once the new level is established. Four new tests
pin all of that, including that a long stable past cannot drown out a recent
drop. After the fix: **65 alerts → 5**, and those five are a genuine ~10 % jump.

### F-019 · S1 · The forecast lagged a growing business — **FIXED, then fixed again**
Splitting the year at the point the growth trend starts:

| | n | bias | MAPE |
|---|---:|---:|---:|
| ordinary days, flat period | 102 | **−1.5** | 9.55 % |
| ordinary days, growth period | 128 | **+19.9** | 9.51 % |

Before the business started growing Ope was essentially unbiased. Once it grew,
Ope ran ~20 customers low **every single day** — and since the ordering advice is
derived from the forecast, it under-ordered every day too.

*Root cause, and it is a structural one:* **inverse-error weighting is blind to
bias.** A model that is consistently 20 low and a model that is unbiased but
noisier can have exactly the same MAE, so the ensemble never learns to prefer
the honest one. When demand grows, *all* the trailing-average models are low in
the same direction and all keep similar MAEs, so the blend simply inherits the
lag. The linear-trend model is in the mix and would have corrected it, but it is
one of four near-equally-weighted voices. Spec §2 predicted this exact failure;
the tracking signal in §7 is supposed to catch it, but it was only ever
*reported*, never fed back into the blend.

*Fix:* each model is now shifted by its own recent signed holdout error before
blending — which is what a tracking signal is *for*.

**The first attempt made accuracy worse, and that is worth recording.** Shrinking
the correction by sample size alone cut the bias (+18.7 → +11.5 customers) but
pushed MAPE from **10.32 % to 11.67 %**: with only four holdout points per
weekday, most of the "bias" being corrected was noise. The correction is now
weighted by how large the mean error is against **its own standard error**
(`weight = max(0, 1 − (se/mean)²)`), so a mean no bigger than its own noise moves
the forecast not at all, while a consistent lag across many observations is
applied nearly in full. Measured A/B, with and without, on identical years.

### F-020 · S1 · One promo uplift for all weekdays under-forecast Sundays badly — **FIXED**
After F-017 the promo bias fell from +112 to +54, but the residual was very
unevenly spread:

| | n | bias | MAPE |
|---|---:|---:|---:|
| weekday promo days | 43 | +26.2 | 10.52 % |
| **Sunday promo days** | 12 | **+151.7** | **24.86 %** |
| Sunday, no promo | 35 | +2.8 | 13.50 % |

*Root cause:* a promotion mostly rescues the **quiet** days. This restaurant's
Sundays are its weak day, so a promotion lifts a Sunday far more than a weekday —
and a single pooled uplift splits the difference, over-correcting weekdays and
badly under-correcting Sundays. Any business with an uneven week has this shape.

*Fix:* the uplift is now learned per weekday, shrunk toward the business's pooled
uplift, which is itself shrunk toward "no change". With no same-weekday promo
history it is exactly the pooled figure; with plenty it converges on the
weekday's own. Five more known-answer tests.

### F-022 · S1 · A day that hasn't happened yet could be logged — **FIXED**
Nothing stopped a future-dated day record. `POST /day-records` with
`2027-01-01` returned **201 Created**. A mistyped year was accepted in silence
and then did damage in two places: the phantom day joined the forecast's
training history, and its "sales" were subtracted from projected stock with no
delivery ever arriving to match, dragging the projection down permanently.
Now refused with a plain-language message; today and past dates are unaffected.

Related and fixed with it: `_compute_projected_stock` summed sales with **no
upper date bound** while counting arrivals only up to today — so any future-dated
record silently corrupted the stock figure. Sales are now bounded at today too,
matching arrivals.

### F-023 · S2 · "Order now — quantity 0", 17 times — **FIXED**
The reorder screen told the owner to order immediately and then suggested
**zero units**, with no explanation. It happens when a product's storage
capacity is smaller than its reorder point: the shop physically cannot hold
enough to cover a delivery, so it hovers below the reorder point forever no
matter how diligently the owner orders (Milkshake: 400 units of storage,
reorder point 475).

*Fix:* "order now" is never shown with a zero quantity. Instead the owner is told
what is actually wrong — *"There's no room for more right now — your storage is
full"* — and, when the shortfall is structural, *"Your storage holds 400 cups,
but covering a 3-day delivery needs about 475. Order smaller amounts more often,
or make more room."*

### F-024 · S2 · Ordering advice was shown in English regardless of language — **FIXED**
The ordering constraint notes were English prose generated in the backend and
rendered raw, so a Hebrew, Spanish or Japanese owner read *"Capped at 200 — your
storage limit."* in English on a screen they look at every day. This is the exact
localisation leak the project spec keeps calling out.

*Fix:* the engine now returns a structured `{code, params}` alongside the English,
following the pattern already used for the staffing notes (the client formats it,
the English stays as a fallback). Four new codes translated into **all 15
languages**; the web panel prefers the codes and falls back to the prose. Five
tests, including one asserting that every English note has a structured twin so a
translated client can never silently drop a warning the English one shows.

### F-025 · S1 · Staffing collapsed to "schedule 1 person" on mixed logging habits — **FIXED**
`app/engine/live_sales.py: service_minutes_per_customer`. **A defect in my own
earlier F-010 fix**, caught by the feature sweep over the finished year.

The sweep showed *"For 1–2 pm, schedule 1 person"* for an hour with **69
customers**, at a 0.5-minute wait. One person cannot serve 69 covers an hour.

*Root cause:* the fix divided the work measured on the days that HAVE product
detail by the customers counted on **all** days. That is fine when an owner
always logs products, but most do not — the simulated owner tapped products for
about three weeks and then switched to end-of-day totals, which is exactly what
a busy restaurant does. So a year of customer counts was divided into three
weeks' worth of product detail: **0.53 minutes per customer instead of 8**.

*Fix:* the work total and the customer total now come from the same set of days,
falling back to the business's configured average when there is no product
detail at all. Staffing returned to a sane 11–13 people at 2.5–4.7 minute waits.
Three tests, including one that replays a realistic mixed year (three tapped
days out of a hundred) and asserts the answer stays near 8 minutes rather than
collapsing toward zero.

**Worth noting as a lesson:** this bug was introduced *by a fix*, passed its own
unit tests, and was only caught because the sweep looked at the numbers on a
realistic year rather than a synthetic fixture.

### The free-tier limit fix biting in a realistic year
With F-018 fixed, the simulated account's trial expires after 30 days and the
**free ad allowance genuinely runs out mid-year** — the run log records five
refusals with the upsell message. The simulated owner now does what the limit is
designed to prompt: upgrades and retries. That is the limit working end to end
over a year of real usage, not just in a unit test.

## Investigations

### F-026 · S2 · The "self-correcting weights" were correcting almost nothing — **FIXED**

The ensemble weights sat at 0.258 / 0.252 / 0.246 / 0.237 across the year — a
plain four-way average to three decimals. Two explanations were possible and
they call for opposite responses, so I replayed the app's own four models over
the observed series, walking forward and only ever using earlier data
(`tests/simulation/analyse_weights.py`). **Both turned out to be true.**

**The models genuinely are close in skill.** Over 283 days their true MAE was
65.3 (linear trend), 65.5 (seasonal naive), 65.6 (exponential smoothing) and
70.5 (weighted moving average) — a best-to-worst spread of just **7.9 %**. They
are four ways of averaging the same same-weekday history, so they mostly agree:
the two closest disagree by only 11 customers a day on a 529-customer day.

**But there is real per-weekday signal, and the weighting was not using it.**

| weekday | best model | spread best→worst |
|---|---|---:|
| Monday | exponential smoothing | 17.4 % |
| Tuesday | seasonal naive | 21.9 % |
| Wednesday | exponential smoothing | 12.4 % |
| Thursday | seasonal naive | 11.5 % |
| Friday | linear trend | 18.2 % |
| Sunday | seasonal naive | 11.5 % |

Different models win different weekdays by 11–22 %, exactly as spec §2 claims.
Two things were stopping the app from acting on it:

1. **Inverse-error weighting cannot express a strong preference.** `w ∝ 1/err`
   means models 8 % apart in skill get weights 8 % apart. Even handed the true
   full-year skill, it produced 0.255 / 0.236 / 0.254 / 0.255 — the clearly
   worst model still collecting nearly a quarter of the vote.
2. **Four holdout points is not enough to tell the models apart.** A 4-point
   window picked the model that was truly best on that weekday only **42.9 %**
   of the time (chance is 25 %). The weights were largely reacting to noise.

Net effect, measured: the re-weighting was worth **0.02 percentage points**
against literally splitting the vote evenly (13.142 % vs 13.163 % on the raw
four-model blend). The headline feature was doing nothing.

**Verdict: a real defect, not "working as intended".** Not a correctness bug —
the mechanism does what the code says — but it fails its own stated purpose.

**Fix**, both parts justified independently of this data:
* `model_weights` now uses `w ∝ (1/err)²`. That is the standard Bates–Granger
  result: the variance-minimising combination weights are proportional to the
  inverse of each model's error *variance*, and MAE scales with σ. It is the
  textbook rule, not a number tuned to fit. Errors of 0.1 and 0.2 now give
  0.80 / 0.20 instead of 0.67 / 0.33.
* The weighting window goes from 4 same-weekday errors to 12 — the same window
  the bias check already uses, and justified by the 42.9 % measurement above.

Replayed walk-forward with no hindsight, blend error falls **monotonically**
across a 4×6 grid of window and sharpness with no turning point, which is what
distinguishes a genuine effect from a lucky corner.

**One uncomfortable number, stated plainly:** on this business, seasonal-naive
*alone* scored 12.98 % against the four-model blend's 13.14 %. Blending four
similar models was, until this fix, slightly *worse* than using the single best
one — because the weakest model kept a quarter of the vote. Even perfect
hindsight model-selection per weekday would only have reached 12.67 %. See the
recommendations in `REPORT.md`: the ensemble is worth far less on this business
than its prominence suggests.

### F-007 · S2 · Outlier detection pestered a very steady business — **FIXED**

Previously left as a deliberately-failing test; now fixed properly.

Measured directly: the detector fired on a **4 % deviation** for a steady shop
(Mondays 98–103, flagged 104) while correctly ignoring a **16 %** deviation for
a variable one. That is backwards, and it is the same complaint that produced
the original "43 flagged against a ~54 average" report.

*Root cause:* Tukey fences are **scale-free**. They ask "is this unusual for
this shop?" and never "is it unusual enough to care?". On a tight history the
IQR is about 1.5 customers, so 1.5×IQR puts the fence three customers above
normal and ordinary life trips it.

*Fix:* a flag now requires **both** conditions — outside the Tukey fence
(unusual for this shop) **and** at least 25 % away from that weekday's median
(unusual enough to act on). This is the standard statistical-versus-practical
significance distinction, and because it is an AND with the existing fence it
can only ever make the detector quieter, so every "must not flag" case in the
spec stays satisfied by construction rather than by luck. Spec §12's own worked
example calls a day ~20 % below the weekday mean "normal variation", which sets
the floor's lower bound.

Verified: 104-vs-100 (4 %) and 108-vs-100 (8 %) no longer flag; 48-vs-100 (52 %),
250-vs-505 (50 %) and 1500-vs-54 still do. Five tests replace the single xfail,
including one asserting the floor can only quieten the detector.

**Deliberate trade-off, recorded:** for an extremely steady business a 15 %
swing is genuinely strange but will not prompt. Ope errs toward not pestering,
which is the priority spec §6 sets.

---

## Phase 4 — UI pass

Drove the real web app in a browser against the finished simulated year, in
light and dark mode and in English and Hebrew (RTL). There is **no Playwright or
axe suite in this repo** — `web/package.json` has no test runner at all — so
this was a manual visual and data-consistency pass, not an automated one.

**What was right.** Dark mode and Hebrew RTL both render correctly throughout,
including the Recharts axes (Hebrew weekday abbreviations), the series chips,
the ordering cards and the tinted ad slots. The layout mirrors properly. Product
names stay in the language the owner typed them in, which is correct. The
staffing figures on screen matched the API exactly, the busy-hours peak agreed
across both screens, and the "Heads up" stock nudge named exactly the three
products the ordering endpoint had flagged. Regulars show CLV plus this-month /
this-year / all-time revenue and a per-regular revenue chart — the spec's
complaint that "there is nowhere that actually shows a regular's profitability"
is resolved.

### F-027 · S1 · The ordering card listed a whole year of deliveries as "in transit" — **FIXED**

The single worst thing in the UI pass. After a year the home screen carried
about **120 "In transit" rows per product**, each with its own *Mark arrived*
button, for orders delivered months ago. The page was roughly **55,000
characters** long. No owner could use that screen.

*Root cause:* orders are created `pending`, and `_compute_projected_stock` has
always honoured the business's "always assume orders arrive on time" setting —
but the **stored status never changed and nothing else consulted the setting**.
So the stock projection said "arrived" while the order list said "in transit",
about the same rows, on the same screen.

*Fix:* `GET /orders` now returns `effective_status`, which resolves a pending
order whose delivery date has passed to `arrived` when that setting is on (the
stored value is left untouched). The card shows only deliveries genuinely still
coming, newest first, capped at four with a "+N more on the way" line so it can
never become a wall again. Page went from ~55,000 characters to **3,871**.
Three tests cover the setting on, off, and an explicitly-confirmed arrival.

### F-028 · S1 · Growth was being reported as seasonality — **FIXED**

The Insights "coming up" section confidently announced **three consecutive
months as "typically a slower month"**, each 20–25 % down. The simulated
restaurant has **no monthly seasonality whatsoever** — it had simply grown about
23 % over the year.

*Root cause:* it compared last year's month against the owner's **current**
pace. For any growing business every prior-year month is below today's pace, so
every future month gets labelled slower. Three in a row is the tell.

Spec §1.6 requires these insights to be "true, data-driven, no fabrication", and
this was a confident, plausible-sounding, false claim.

*Fix:* compare that month against the level the business was running at **around
that time** (a ±5-month window), which cancels the trend and leaves only the
seasonal shape. The message now states the expected pace for *this* year rather
than quoting last year's raw figure as a prediction. On the simulated year it
now correctly says **nothing at all**; a synthetic business with a genuine 30 %
October dip *on top of* the same growth is still caught, and is told to expect a
figure above last October's because it has grown since. Six tests.

### F-029 · S2 · Monthly Trends hid 55 real trading days — **FIXED**

It reported **"256 days logged"** where the owner had logged **311**, and showed
those 55 days as gaps in a chart captioned *"Every day you've logged, in order.
Gaps are days with no entry."*

*Root cause:* the trends endpoint reused `_clean_records`, the **forecasting
baseline**, which strips every day inside a tagged ad or event. That is right
for training a model and wrong for a history view — it drew the monthly trend
line for a business that had never run a promotion, and understated the busiest
months.

*Fix:* a separate `_history_records` for history and trends: every logged day at
its real value, still honouring the owner's own fluke exclusions and their
closed weekdays, still never zero-filling a missing day. Now reports 309 (311
minus the two days the owner explicitly marked as flukes).

### F-030 · S2 · Dates and money ignored the language picker — **FIXED**

`Intl.NumberFormat(undefined, …)` and `toLocaleDateString(undefined, …)` follow
the **browser's** locale. An owner who had switched Ope to English still read
Hebrew dates and Hebrew-marked currency on the regulars screen, and an English
speaker on a Hebrew browser would see the same. Both now take the language the
owner picked in the app.

### F-031 · S3 · "Saving…" shown while loading — **FIXED**
The demand-forecast card showed *Saving…* during a read, telling a nervous
owner the app was writing something when it was only fetching.

### F-032 · S3 · `npx tsc --noEmit` type-checked nothing and exited 0 — **FIXED**
`web/tsconfig.json` was solution-style: `"files": []` plus `references`.
References are only followed by `tsc -b`, so plain `tsc` compiled **zero files**
and reported success. That is worse than having no check at all — it reports
clean on code that does not compile. It passed `RegularsPanel.tsx` while
`npm run build` immediately failed on the same file with eight errors.

*Fix:* the default project is now the app itself — `tsconfig.json` extends
`tsconfig.app.json` and includes `src`, so `npx tsc --noEmit` checks the
application source with exactly the settings that were always intended. The
build script becomes `tsc -b tsconfig.json tsconfig.node.json`, so
`vite.config.ts` keeps its own separate node-typed project and **nothing is
checked more loosely than before**.

Note on what does *not* work here: keeping `references` alongside an `include`
fails, because outside build mode tsc treats referenced projects as prebuilt
declarations (TS6305) and demands `composite: true` (TS6306/TS6310), which these
deliberately `noEmit` projects cannot have.

Verified by introducing a deliberate type error and confirming both commands now
report it identically, then removing it and confirming both are clean; and
separately by breaking `vite.config.ts` to confirm the build still covers it.

## Phase 5 — analysis

_not started_

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

### F-006 · S2 · Hourly backfill destroys same-day product taps
`app/api/sale_events.py:81-85` — `backfill_hourly` deletes **every** SaleEvent in
the day's window, then re-inserts one customer-count row per hour with
`product_id=None`. An owner who tapped products during the day and later
backfilled corrected hourly customer counts from their register loses the entire
product breakdown for that day. Not verified end-to-end yet; flagged from reading.

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

### The free-tier limit fix biting in a realistic year
With F-018 fixed, the simulated account's trial expires after 30 days and the
**free ad allowance genuinely runs out mid-year** — the run log records five
refusals with the upsell message. The simulated owner now does what the limit is
designed to prompt: upgrades and retries. That is the limit working end to end
over a year of real usage, not just in a unit test.

## Phase 4 — UI pass

_not started_

## Phase 5 — analysis

_not started_

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

_not started_

## Phase 2 — days 15–90

_not started_

## Phase 3 — days 91–365

_not started_

## Phase 4 — UI pass

_not started_

## Phase 5 — analysis

_not started_

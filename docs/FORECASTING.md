# Forecasting Engine

> Part of the ops-forecast documentation set. See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the index and roadmap.

## Core Principle: Let the Data Choose the Weights

We do **not** hard-code that "same date last month" or "yesterday" matters most. For most businesses the strongest signal is **day-of-week** (this Saturday ≈ last Saturday), then events/holidays, then longer-term trend, with monthly pay-cycle effects a distant fourth. But it varies by business, so:

The app runs several simple forecasting models in parallel, tracks each model's recent error per weekday, and blends their predictions weighted **inversely to how wrong each has recently been**. A model that has been accurate lately gets more say; one that is drifting gets quietly down-weighted. This *is* the "self-correcting weights" feature, and it is far more robust than one large model trying to do everything.

**Currently active (per code audit):** seasonal-naive (unweighted mean of all same-weekdays), weighted-moving-average (last 4 same-weekdays, recency-weighted), and exponential smoothing (α=0.3), blended by inverse holdout-MAE per weekday. Outliers are median-substituted per weekday; missing days are absent (never zero).

**Explicitly NOT doing:** weighting a single "same date last year" or one "month-ago day" as a direct predictor. One old data point is noise, not signal. Long-range memory comes from seasonality and the YoY model below — not single matched dates.

### Trend Awareness (improvement to implement)

The active models are all recency-*level* estimators with no explicit trend term, so if demand is steadily rising or falling week over week, the forecast systematically lags (predicts low in growth, high in decline) because it averages past same-weekdays rather than projecting the direction.

**Add a trend component:** a linear-trend or Holt's-linear model added to the ensemble, weighted by its own holdout accuracy like the others, so it only gets influence when it's actually predictive. Test that a steadily rising series forecasts *above* the last point, not at the trailing average.

### Year-Over-Year Signal

Use last year's data the MOMENT any exists — do not wait for a full year. Add a **year-over-year model to the ensemble** fed two signals:
1. The **same WEEKDAY ~52 weeks ago** (this Sunday compared to Sundays around the same time last year — same weekday, NOT the same calendar date, since one specific date is noise).
2. **Last year's trend/level for the surrounding week/month** (the general direction/level a year ago, e.g. "last year around now was rising / was ~X").

**Self-weighted by accuracy, with the no-data guard (critical — same protection that stopped the linear_trend 915 blow-up):** this model gets **zero/minimal weight** with little or no year-ago data (never a floor that lets it dominate on thin data) — it can only gain influence once validated by real year-ago points. It earns its say; it can't wreck the forecast prematurely.

Degrades gracefully: with no year-ago data, contributes nothing and the forecast behaves exactly as today.

**Owner-facing:** monthly comparison can also show same-month-last-year (this June vs last June) once that data exists.

### Self-Tuning (champion/challenger shadow testing)

Beyond per-model self-weighting, periodically search over different *meta-weightings* of signal groups (e.g. how much to trust recent-week vs month vs year-ago) to find which blend would have predicted past actuals most accurately. Run the best candidate ("challenger") **silently in shadow mode** alongside the current live blend ("champion"); if the challenger keeps winning under the guardrails, it quietly becomes the new champion. Invisible to end users.

**Guardrails are mandatory — without them this overfits and can make forecasts worse:**
- **Out-of-sample validation (the key anti-overfit defense, non-negotiable):** a challenger must prove itself on holdout data it did NOT tune on — never adopt a weighting just because it fit past data well.
- **High switch threshold + meaningful period:** the challenger must beat the champion **consistently over a meaningful window** (NOT a few days) and by a **real margin** (not a trivial fraction) before adoption.
- **Bounded weight options:** only sensible weight ranges are tried — never extreme blends (same anti-domination guard that stopped the linear_trend 915 blow-up).
- **Safety floor / instant rollback:** if an adopted challenger ever performs worse live, snap back to the champion immediately.
- **Thin-data guard:** with insufficient history (e.g. the current ~26 days), the system must NOT switch at all. Stays on the safe default until there's enough data.
- **DEVELOPER-VISIBLE LOG (not shown to end users):** every shadow comparison and every switch is logged ("switched meta-weighting on date X because challenger beat champion by Y% out-of-sample over Z period"). NOT a silent black box — a hidden mechanism that can degrade forecast quality must be inspectable, or a silent regression can't be diagnosed.

---

## Forecasting Engine Design

`engine/` is pure functions: inputs in, numbers out, no database, no framework. This keeps it trivially testable and reusable.

### Pipeline Per Forecast

1. Pull the business's clean history, excluding (or flagging) days inside event/ad `Period`s so they don't pollute the "normal" pattern.
2. Run each base model to predict the target date:
   - *Seasonal-naive:* average of recent same-weekday values.
   - *Weighted moving average:* recent values, most-recent weighted heaviest, weights sum to 1.
   - *Exponential smoothing:* `F_next = αA + (1−α)F`.
   - *Holt-Winters:* level + trend + seasonal; multiplicative seasonality usually fits retail (swings scale with volume).
3. For each model, compute its rolling error (MAPE over the last N comparable days). Convert errors to weights inversely (`w_i = (1/err_i) / Σ(1/err_j)`); guard against divide-by-zero with a floor.
4. Blend: `forecast = Σ w_i · prediction_i`.
5. Apply the relevant **seasonality index** if the chosen base method doesn't already include seasonality.
6. Produce a **prediction interval** that shows the **PROBABLE range, not the POSSIBLE range.** A range like 47–123 for a business that reliably does ~90 is technically a wide confidence band but practically useless. Show where demand *usually* lands (e.g. a ~50–68% band, roughly ±0.7σ, or an IQR-based band of typical days), so a ~90 business sees something like ~80–100, not 47–123. Base it on the **actual distribution of that weekday's real values / recent errors of the VALIDATED models only** — never just the min-to-max of history, and never inflated by unvalidated models. Keep it whole-number for whole-unit businesses.

### Critical Integrity Rules

These have repeatedly been mis-implemented — they must actually work end to end, verified by tests:

- **A missing/unlogged day is NOT zero.** Must be excluded from averages, never counted as 0 customers/units. Symptom of the bug: the app forecasting 0 for a product on some weekday because absences were averaged in as zeros. A forecast must never be dragged down by days that simply weren't recorded.
- **Closed days / non-working days are excluded entirely**, not treated as zero.
- **Outlier detection uses IQR (interquartile range) — NOT a tight std-dev rule.** The current detector is far too sensitive (it flagged 43 customers against a ~54 average, which is completely normal variation). Replace with: compute Q1 and Q3 of that weekday's history, IQR = Q3−Q1, flag a day only if it falls below `Q1 − 1.5·IQR` or above `Q3 + 1.5·IQR` (Tukey fences; use 3·IQR for "extreme"). Evaluated **per weekday** against that weekday's own distribution. Needs enough history (several same-weekday points) before flagging at all.
- **Flag and ask — never silently delete.** A spike is often real (holiday, viral day, competitor closed). Prompt in plain language ("Sunday looks unusually high — one-off, or a real event?"); the owner chooses: mark event/ad, exclude as fluke, keep, or **mark as a recurring pattern** (RecurringPattern — then it's expected, not flagged again). Down-weight un-reviewed outliers; never fully discard silently.
- **Outlier detection still runs DURING event/ad periods** — a day can be unusually low/high even for an event period, and the owner must STILL get the choice to flag it as a fluke even while an event is running. An unusually weak day during an event is both: still flaggable as a fluke, AND relevant to that event's lift analysis (the event may be underperforming).
- **Keep alerting on large day-to-day range** *unless* the owner has explained it (event/ad/recurring) **or it recurs consistently** (then the engine learns it as the pattern, not noise).

### Change-Detection (a core, durable-value output)

Beyond predicting the steady state, Ope must **flag when the steady state breaks** — sustained drift (e.g. "down ~8% over 3 weeks"), an unusually weak/strong day, or a regime shift. Humans are poor at noticing slow drift; this is where lasting value lives. Surface these as plain-language alerts. The tracking signal (§ Formula Catalog) is one mechanism.

**Pipeline additions:** recurring patterns (RecurringPattern) are folded into the relevant weekday/hour as expected demand before anomaly checks run.

### Per-Product Demand Forecasting

Forecast demand **per product**, not only total customers (e.g. "order ~40 oranges"). Each product's unit-sales history feeds the same engine. **Present as ONE shared, switchable chart** that toggles between Week-prediction / Demand-by-product / What-to-order, with total customers as just one selectable series (show one series at a time). Respect each product's `unit_mode` (whole vs decimal) in the output. **When a product has enough detail (capacity, usual sales, lead time), surface the recommended order *quantity* ("order ~40"), not just the reorder *trigger*.**

### Ordering Bridge

This turns a forecast into a decision:
- Expected demand over lead time = forecast summed across the next `lead_time_days`.
- Safety stock = `z × σ_dLT` (z = service-level z-score; σ_dLT = std dev of demand over lead time).
- **Reorder point = expected demand over lead time + safety stock.** Recommend ordering up to (or above) the upper prediction interval to avoid stockouts; round per `unit_mode`.
- **Constraints use CAPACITY and SHELF-LIFE only — never cost.** Holding cost and order cost fields must NOT exist anywhere in the UI or database — remove them if present.
- EOQ is advanced-only — needs cost inputs users can't supply; never a required field or default-shown option.
- When `capacity` is set, never recommend beyond what fits. When `shelf_life_days` is set, never recommend more than can realistically sell before spoilage. Surface a plain-language note when a constraint is binding ("capped at 200 — your storage limit"). If neither is set, ordering is unconstrained.

---

## Formula Catalog

### Demand Forecasting
- **Simple moving average** — mean of the last *n* observations.
- **Weighted moving average** — weighted mean of the last *n*, weights summing to 1, most recent heaviest.
- **Exponential smoothing** — `F_t+1 = αA_t + (1−α)F_t`, with 0 < α < 1.
- **Holt-Winters (triple exponential smoothing)** — level (α), trend (β), seasonal (γ). Likely the primary engine.
- **Linear regression / trend projection** — fit `y = a + b·t`; these are the *same* technique (time as the predictor), so treat as one tool, not two.
- **Seasonality index** — `index_d = average(day d) / overall average`; multiply a base forecast by the index.
- **ARIMA** — *Phase 3 / advanced only.* Powerful but easy to over-fit on ~1 year of daily data and hard to auto-tune; not worth the fragility in the MVP.

### Customer Value
- **CLV (Customer Lifetime Value)** — for a tracked Regular: roughly `visit_frequency × avg_spend × expected_lifespan` (with margin if known). Computed automatically when the owner enters a regular's frequency and spend; refined by observed visits if they use "Record a regular." Lives in the separate regulars data, never in demand history.

### Forecast Accuracy (drives the self-correcting weights)
- **Forecast error** — `actual − forecast`.
- **MAD** — mean of |error|.
- **MSE** — mean of error².
- **MAPE** — mean of |error| / actual, as %. Intuitive ("off by 11%"). Exclude near-zero/closed days.
- **Tracking signal** — running sum of errors ÷ MAD; past ±4 → biased, recalibrate. Also a **change-detection** signal.
- **Coefficient of variation** — std dev ÷ mean; how predictable the business is.

### Ordering
- **Reorder point**, **safety stock**, **service-level z-score**; constrained by **capacity & shelf-life** (not cost). EOQ advanced-only. See ordering bridge above.

---

## Known-Answer Test Cases

Seed the test suite with these — textbook ops problems have exact answers:

- **SMA**, data `[10,12,14,16]`, n=3 → `(12+14+16)/3 = 14`.
- **WMA**, last three `[10,20,30]` (oldest→newest) with weights `[0.2,0.3,0.5]` → `0.2·10 + 0.3·20 + 0.5·30 = 23`.
- **Exponential smoothing**, α=0.3, F=100, A=120 → `0.3·120 + 0.7·100 = 106`.
- **Linear regression / trend**, points `(1,10),(2,12),(3,14)` → slope 2, intercept 8; forecast t=4 → `16`.
- **Seasonality index**, overall avg 100, Saturday avg 150 → index `1.5`; Saturday forecast = base × 1.5.
- **MAD**, errors `[2,−3,4,−1]` → `(2+3+4+1)/4 = 2.5`.
- **MSE**, same errors → `(4+9+16+1)/4 = 7.5`.
- **MAPE**, actuals `[100,200]`, forecasts `[110,180]` → `(0.10+0.10)/2 = 10%`.
- **Tracking signal**, errors `[2,−3,4,−1]` → RSFE 2, MAD 2.5, TS `0.8`.
- **Little's Law**, λ=2/min, W=5 min → L = `10`.
- **Reorder point**, avg daily demand 50, lead time 4 days, z=1.65, σ over LT 20 → demand-in-LT 200, safety stock ≈ `33`, ROP ≈ `233`.
- **EOQ**, D=10000, S=50, H=2 → `√(2·10000·50/2) ≈ 707`. (Advanced-only; never required.)
- **IQR outlier**, a weekday's history `[50,52,54,53,55,51,43]`: Q1≈51, Q3≈54, IQR≈3, lower fence ≈ 51−4.5 = 46.5, upper ≈ 54+4.5 = 58.5 → **43 is below 46.5 only slightly; with a realistic larger sample 43-vs-54 must NOT flag.** Test that ordinary variation (e.g. 43 when the weekday mean is 54 and spread is normal) is NOT flagged, and that a genuine extreme (e.g. 1500 vs ~54) IS flagged.

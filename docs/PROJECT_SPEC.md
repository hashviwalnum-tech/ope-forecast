# Operations Forecasting App — Project Specification

> Detailed blueprint. The root `CLAUDE.md` is a short pointer to this file. Update this doc as decisions change; treat it as the source of truth for scope and design.

## 1. Vision

A forecasting and decision tool for owners of small customer-facing businesses (shops, cafés, restaurants, salons, clinics). The owner records what sells — either as end-of-day totals or, better, by tapping a button the moment each sale happens — and the app learns the patterns and predicts future demand by day of week (and by hour and month for premium), tells the owner how much to order, recommends how many staff to schedule per shift, and measures whether ads and events actually moved the numbers. Crucially, it grades its own forecasts against reality and re-weights itself so accuracy improves over time.

**End-state:** the long-term product is a mobile app and/or an extension that plugs into smart registers (POS systems), which already emit a stream of time-stamped transactions. Designing around live, per-transaction data now (see section 5) means the app's data model already matches what a register provides, so the integration later is a natural fit rather than a rewrite.

## 1.5 Product identity, branding & design language

- **Name:** **Ope**.
- **Slogan:** "Know Tomorrow, Today."
- **Logo:** the provided "OPe" mark in blue with a green accent (stored in the repo under `web/src/assets/`). Use it in the header and as the favicon.
- **Audience:** owners of *small* businesses, not large companies. Many are adults who are not comfortable with technology (potential technophobes). This drives every UX decision below.
- **Design language — calm, comfortable, inviting:**
  - **Palette:** soft blue-green, relaxing rather than corporate or high-contrast. Blue as the primary, green as the accent (matching the logo). Plenty of whitespace, gentle rounded corners, no harsh pure-black-on-white.
  - **Plain language everywhere:** no jargon in the UI. Say "How busy will tomorrow be?" not "Forecast horizon"; "You'll likely need this much" not "Reorder point = …". Keep statistical terms (MAPE, tracking signal) in an optional "details" area, not the main view.
  - **Big, obvious controls:** large tap targets, clear single primary action per screen, readable font sizes. Assume a nervous first-time user on a phone.
  - **Palette — calm but alive (corrected):** the original was too bright; a first pass overcorrected to too grey/washed-out. Aim for the middle: soft, low-saturation teal/blue-green with enough warmth and life to feel inviting, not clinical or grey. Backgrounds and the ad-slot/bottom areas must use a **soft tint, never pure white**. Consistent across all screens.
  - **Home screen layout (ordered, top to bottom) — "what do I need right now":**
    1. **Quick actions** (Record a sale, Log today) — MOST prominent, at the very top. Currently buried; must be the first thing seen.
    2. **What to order now** — high.
    3. **Forecast by product** — high; **merge with the customer forecast into ONE switchable chart** where "customers" is just one selectable series alongside each product. Switch which series to view.
    4. **Week prediction** — prominent.
    5. **Busy hours** — show **tomorrow's** (not today's — today is already in motion and not actionable), followed by a **forecast of peak hours for each day of the week**. Present but slightly less upfront than the above.
    - **Remove from home:** "your typical week" and "how is the app doing" (not useful on home). **Move "how our predictions did" into the Manage menu** (it's a review tool, not a right-now decision).
  - **Ad slots:** widen the side slots to use more of the edge space (currently too narrow); keep them tinted (not white) and non-intrusive.
  - **Information architecture — focus on the short term first, nest the rest.** The top level currently has too many buttons (~11), which overwhelms. Reorganize so the home screen leads with the immediate essentials — **this week's forecast, today/this-week's hours, and other short-term decisions** — and everything else (settings, products, past-data, history, analytics depth) is **grouped and nested** behind fewer, clearly-labelled entry points. The first thing the owner sees should answer "what do I need to know right now."
  - **Guidance over blank slates:** short helper text, sensible defaults, and friendly empty/"not enough data yet" states that reassure rather than alarm.
  - **Forgiving:** easy undo, confirm before anything destructive, and never punish a wrong tap.

## 2. Core principle: let the data choose the weights

The single most important design decision. We do **not** hard-code that "same date last month" or "yesterday" matters most. For most of these businesses the strongest signal is **day-of-week** (this Saturday ≈ last Saturday), then events/holidays, then longer-term trend, with monthly pay-cycle effects a distant fourth. But it varies by business, so:

The app runs several simple forecasting models in parallel, tracks each model's recent error per weekday, and blends their predictions weighted **inversely to how wrong each has recently been**. A model that has been accurate lately gets more say; one that is drifting gets quietly down-weighted. This *is* the "self-correcting weights" feature, and it is far more robust than one large model trying to do everything.

## 3. Scope and phased roadmap

Build in phases. Prove the forecasting works before investing in accounts, billing, and integrations.

### Phase 0 — Scaffold
Repo structure, FastAPI backend skeleton, React web skeleton, the `engine/` package with empty modules and a test harness, basic CI running the test suite.

### Phase 1 — MVP (the value proof). No login, no billing, single user, local SQLite.
- Manual daily entry: date, customers, and per-product units sold.
- Import past data via CSV and manual backfill.
- Forecasting models: seasonal-naive (day-of-week), weighted moving average, exponential smoothing, Holt-Winters (level + trend + seasonality).
- Ensemble that re-weights by recent per-weekday error (section 2).
- Accuracy panel: MAD, MSE, MAPE, tracking signal.
- Ordering: reorder point + safety stock from the forecast and chosen service level; show a prediction interval (e.g., "Sat ≈ 120, 90% chance 95–145").
- Views: next 7 days forecast; average-by-day-of-week chart; actual-vs-forecast history.
- Mark date ranges as an **event** or **ad**, and report the lift vs the no-event baseline (section 6).
- "Not enough data" states everywhere thresholds aren't met (section 7).

### Phase 1.5 — Branding, calm UX redesign & live capture (the next build)
Apply the Ope identity and design language from section 1.5 to the existing web app: logo, slogan, blue-green palette, plain-language labels, big friendly controls, reassuring empty states. Add a **fast "add product" flow** and the **tap-to-record live sales** feature (SaleEvent in section 5) with an end-of-day view of sales rolled up by hour. This is foundational, not premium, because it produces the hourly data later features depend on.

### Phase 2 — Accounts and cloud persistence
Goal for this phase: make Ope reachable from a locked-down work computer through nothing but a web browser (no installs possible on that machine), with a login in place *before* it goes public so data is never exposed.

Concrete decisions:
- **Auth + cloud database via Supabase** (one managed service for both). Use Supabase's built-in authentication — do NOT hand-roll password storage/hashing/reset; the managed service handles the security-critical parts. Email + password login to start.
- **Multi-user from the start.** Every row of business data belongs to an owner (account). Each logged-in user sees only their own business's data. Build this isolation now — retrofitting it later is painful. (Enforce with per-user filtering on every query, and Supabase Row-Level Security as defence in depth.)
- **Migrate SQLite → Supabase Postgres.** Move the existing schema and the user's current data into the cloud database.
- **Hosting:** deploy the backend and the web frontend to a host so they have public URLs (e.g. a managed platform). The work computer reaches the frontend URL in its browser; the frontend talks to the hosted backend.
- Free-tier 1-year data cap enforced server-side; data export.

**Build sub-steps (this phase is the biggest yet — do them one at a time, verifying each before the next):**
- **2a — Supabase project + cloud database:** create the Supabase project, recreate the schema there, migrate existing data, point the backend at Postgres instead of SQLite. Verify the app still works locally against the cloud DB.
- **2b — Login & multi-user isolation:** add Supabase email/password auth; gate the app behind login; attach every business/record to a user; ensure each user sees only their own data; add Row-Level Security. Verify with two test accounts that data is isolated.
- **2c — Hosting/deploy:** deploy backend and frontend to public URLs; wire the frontend to the hosted backend; confirm Ope loads and login works from a normal browser (then test from the work computer).

**Honest risk note:** hosting and cloud auth are materially harder to debug than local work because the app no longer runs on a machine the owner controls. Corporate networks may also block unfamiliar sites — whether the work computer can reach the hosted app is a "try it and see." Keep local-run working as a fallback throughout.

### Phase 3 — Polish, forecasting quality & premium *limits*
**This phase is mostly about making Ope genuinely good, not adding gated features.** Two corrections to earlier assumptions, per the owner:

1. **Hourly analytics, busiest-hour, staffing recommendations, monthly view, and the queueing module are NOT premium — they are core features for all users.** Everyone gets the full toolset and the full forecasting brain. Free is not a crippled version.
2. **Premium = removing limits only, not unlocking features.** Specifically:
   - **Data history cap** — free keeps up to ~6 months to 1 year of history; premium keeps more / unlimited.
   - **Action caps** — free allows a limited number of logged ads/events (e.g. 2); premium allows more / unlimited.
   - Premium is therefore mostly counting + gating logic (a simple per-account flag and limit checks), not separate feature builds. This should be the *easy* part.

**The hard, important work of this phase (where effort should go):**
- **Business logic fix (do first):** on login, auto-load the user's existing business and go straight in — never re-prompt for a business name, never lock a user out for forgetting it. Naming happens only when creating a genuinely new business. Allow adding multiple businesses (count gated by free/premium limit, set generously for now).
- **Full UX polish:** make the app look and feel like a finished product — consistent calm blue-green design throughout, plain language, big friendly controls, smooth flows, good empty/loading/error states. The "looks and interacts like the final product" goal.
- **Forecasting quality:** make sure predictions are actually good — validate against real data, tune the ensemble, confirm the self-correction, outlier handling, missing-day and closed-day logic all behave well together. This is the core value of the app.
- **Edge cases / unique problems:** surface and tackle the odd situations (sparse data, weird patterns, sudden shifts, partial days) as they show up in real use.

Build features (hourly, staffing, monthly) one at a time, test-first where math is involved, then polish. Premium *limits* layer on near the end. **Payments/billing are deferred to a later phase** (see below) — build the free/premium *gating concept* now (a flag + limit checks), but defer real Stripe billing until there are paying users.

### Phase 3.5 — Monetization (deferred until real users)
- **Subscription billing** (Stripe on web) layered onto the premium-limit gating built in Phase 3.
- **Ad placement** as an additional revenue stream. **Placement rules (non-negotiable for trust):** never pop-ups, never overlapping or covering content, never interrupting a flow. On **wide screens (desktop/tablet):** unobtrusive slots in the **side margins**. On **narrow screens (phone):** a single slim banner fixed at the very **bottom**, outside the content area. Always visually separated from real app content (subtle divider / different background) so an ad is never mistaken for part of Ope. **Removing ads is a premium perk** ("no ads"), tying into the premium model.
- **Reserve the space NOW, fill it later (important):** during the Phase 3 UX work, build the *layout containers* for these ad slots (empty or with a subtle placeholder) so that wiring in a real ad network in Phase 3.5 requires no layout rework. Do not integrate an actual ad network yet — just reserve and style the space.
- For mobile, App Store / Play in-app purchases are usually **required** for digital subscriptions and take a 15–30% cut with their own rules — design the premium flow with that in mind.

### Phase 4 — Mobile
React Native (Expo) app reusing the same backend API and a shared TypeScript package (types + API client).

### Phase 5 — Integrations
Smart register / POS connectors to auto-import sales.

## 4. Architecture (this is what makes "web now, mobile later" painless)

**API-first.** All business logic and math live behind a single JSON HTTP API. The web app is one client of that API; the future mobile app is another. Nothing in the backend changes when mobile arrives. Do **not** put forecasting logic in the frontend.

```
ops-forecast/
├── CLAUDE.md                 # short, always-loaded context (points here)
├── docs/PROJECT_SPEC.md      # this file
├── backend/                  # Python + FastAPI  (the brain)
│   ├── app/
│   │   ├── main.py
│   │   ├── db.py
│   │   ├── models/           # SQLAlchemy tables
│   │   ├── schemas/          # Pydantic request/response models
│   │   ├── api/              # thin route handlers (validate → call engine → return)
│   │   └── engine/           # PURE functions, no DB, exhaustively tested
│   │       ├── forecasting.py
│   │       ├── seasonality.py
│   │       ├── accuracy.py
│   │       ├── ordering.py
│   │       ├── queueing.py
│   │       └── ensemble.py
│   ├── tests/engine/         # known-answer tests for every formula (section 8)
│   └── requirements.txt
├── web/                      # React + Vite + TypeScript + Tailwind + Recharts
│   └── src/{api,components,pages,hooks}
├── shared/                   # later: TS types + API client reused by web + mobile
└── mobile/                   # Phase 4: React Native (Expo)
```

### Recommended stack
- **Backend:** Python 3.11+, FastAPI, SQLAlchemy, Pydantic; `numpy`, `pandas`, `scipy`, `statsmodels` (Holt-Winters, ARIMA, regression are already implemented here — do not rebuild them by hand).
- **Database:** SQLite for dev/Phase 1 → PostgreSQL for Phase 2+. SQLAlchemy makes the switch small.
- **Web:** React + Vite + TypeScript + Tailwind + Recharts (or Chart.js) for charts.
- **Mobile (Phase 4):** React Native via Expo.
- **Auth (Phase 2):** JWT, or a managed provider (Supabase Auth / Clerk / Auth0) to avoid hand-rolling password security.
- **Billing (Phase 3):** Stripe for web. For mobile, App Store / Play in-app purchases are usually **required** for digital subscriptions and take a 15–30% cut with their own rules — design the premium flow with that in mind.

Why Python for the engine: the forecasting math is the hard part, and `statsmodels`/`scipy` give battle-tested implementations with proper handling of edge cases. Rebuilding ARIMA or Holt-Winters in JavaScript is a large, bug-prone effort.

## 5. Data model

The app supports **two ways to get data in, feeding one shared analytical layer.** This is the key change driven by the tap-to-record idea.

**Input mode A — daily totals (backfill & past data):** the owner enters end-of-day numbers. Two ways, both needed:
- **Manual entry / backfill screen** — a dedicated screen to add or correct a *specific past day*, separate from "Add Today." Use a **date picker (clickable calendar)**, never a free-text date field, so there is zero date-format ambiguity. The current workaround of changing the date inside "Add Today" is not acceptable as the only option — past-data entry must be a clear, comfortable, first-class feature. **By default this captures daily totals only** (most owners won't recall hourly breakdowns for past days), but offer an **optional way to add hourly detail** for a past day when the owner does have it — e.g. from smart-register logs. This is the same hourly shape POS integration will later import automatically, so building the capability now is forward-compatible. **The CSV import template must also support optional hourly columns**, so bulk history with hours (e.g. register exports) can be imported, not just daily totals.
- **CSV import** — for bulk history. Date handling must be robust: accept common formats, and **show the user how each date was interpreted before saving** (a preview), so DD/MM vs MM/DD confusion and Excel's auto-reformatting can't silently corrupt data. The on-screen example must actually match the stated expected format. Consider accepting ISO `yyyy-mm-dd` as canonical but tolerating others with the confirmation preview.

**Input mode B — live transactions (going forward, and what registers emit):** the owner taps a product button the instant a customer buys it ("just sold bananas" → tap). Each tap is stored as a time-stamped event. This is the richer source: because every sale carries a timestamp, the **hourly view, busiest-hour analysis, and staffing recommendations all derive automatically from this same data** — no separate hourly data entry needed. It also mirrors exactly what a smart register produces, lining up with the end-state.

**Aggregation:** the engine always reads **daily (and, when available, hourly) aggregates**. Those aggregates are either typed directly (mode A) or rolled up automatically from transactions (mode B). The forecasting engine doesn't care which mode produced them — keeping the two input paths cleanly separated from the math.

### Entities
- **Business** — id, name, settings (opening days/hours, default lead time, target service level, average service time per customer for staffing). One row in Phase 1; FK to user in Phase 2. **Opening days/hours must be editable in a settings screen** — and the forecasting engine must use them: closed days are excluded from forecasting entirely (not treated as zero-customer days), and hourly features only consider open hours.
- **Product** — id, business_id, name, unit, optional price, current_stock (optional), lead_time_days, holding_cost (optional), order_cost (optional), **optional service_time_minutes (overrides the business default for staffing math — MUST be exposed in the product add/edit UI under optional details, defaulting to the business setting when blank)**, **optional storage_capacity (max units that physically fit), optional shelf_life_days (spoilage)**. The storage and shelf-life fields are **optional and off by default** — the app must work cleanly for products where neither applies (e.g. clothing has no shelf life; a large warehouse has effectively no storage cap). When present, they constrain ordering advice (see Ordering bridge). Products must be **quick to add and edit** — a fast "add product" flow is a Phase-1.5 priority (see roadmap).
- **SaleEvent** *(mode B — live capture)* — id, business_id, product_id (nullable — a tap can record "a customer" with no specific product), timestamp, quantity (default 1), optional unit_price. The raw transaction stream; the foundation for hourly/staffing features and POS integration.
- **DayRecord** *(mode A — daily totals, or the daily roll-up of SaleEvents)* — id, business_id, date (unique per business), customers (int), notes.
- **SaleRecord** *(mode A)* — id, day_record_id, product_id, units_sold. Per-product daily totals when entered manually.
- **HourRecord** *(derived / premium analytics)* — id, business_id, date, hour (0–23), customers, units_sold. Populated by rolling up SaleEvents; powers busiest-hour and staffing.
- **Period** — id, business_id, start_date, end_date, type ('event' | 'ad'), label, optional cost. Used for lift analysis; excluded from the "normal" baseline when training.
- **ForecastRun** (recommended) — id, business_id, created_at, target_date, predicted value, interval low/high, model weights used. Storing predictions lets accuracy be measured against what was actually predicted.

## 6. Forecasting engine design

`engine/` is pure functions: inputs in, numbers out, no database, no framework. This keeps it trivially testable and reusable.

**Pipeline per forecast:**
1. Pull the business's clean history, excluding (or flagging) days inside event/ad `Period`s so they don't pollute the "normal" pattern.
2. Run each base model to predict the target date:
   - *Seasonal-naive:* average of recent same-weekday values.
   - *Weighted moving average:* recent values, most-recent weighted heaviest, weights sum to 1.
   - *Exponential smoothing:* `F_next = αA + (1−α)F`.
   - *Holt-Winters:* level + trend + seasonal; multiplicative seasonality usually fits retail (swings scale with volume).
3. For each model, compute its rolling error (e.g., MAPE over the last N comparable days). Convert errors to weights inversely (e.g., `w_i = (1/err_i) / Σ(1/err_j)`); guard against divide-by-zero with a floor.
4. Blend: `forecast = Σ w_i · prediction_i`.
5. Apply the relevant **seasonality index** if the chosen base method doesn't already include seasonality.
6. Produce a **prediction interval** from the spread of recent errors (or model residual variance), so the UI can show a range, not just a point.

**Outlier detection & handling** (so one freak day doesn't distort every forecast):
- **Detect relative to the business's own pattern, never with fixed thresholds.** A day is a candidate outlier if it falls far outside the normal spread for that weekday — standard rule: more than ~3 standard deviations from that weekday's mean (or a robust equivalent like median ± k·MAD, which copes better when there are several odd days). This scales automatically: a kiosk and a supermarket each get sensible limits.
- **Flag and ask — do not silently delete.** A spike is often *real and important* (holiday, viral day, competitor closed). When a day is flagged, prompt the owner in plain language: "Sunday looks unusually high (1,555 vs your usual ~150). One-off, or a real event?" Then they choose: mark it an event/ad (excluded from the normal baseline via the existing Period feature), exclude it as a fluke, or keep it as-is.
- **Down-weight by default** until reviewed, so an un-handled extreme value can't dominate the average, but isn't fully discarded either. Silent deletion is forbidden — it would teach the model a falsely flat picture.

**Per-product demand forecasting (core, currently a gap to fill):** the app must forecast demand **per product**, not only total customers — e.g. "order ~40 oranges." Each product's unit-sales history (from tap data / sale records) feeds the same forecasting engine to produce a per-product forecast and order recommendation. **Present this as ONE shared, switchable chart** where total customers and each product are selectable series (treat "customers" as just another selectable item) — not separate charts. **When a product has enough detail (e.g. storage cost, usual sales, lead time), surface the recommended order *quantity* ("order ~40"), not just the reorder *trigger*.**

**Ordering bridge** (this is what turns a forecast into a decision):
- Expected demand over lead time = forecast summed across the next `lead_time_days`.
- Safety stock = `z × σ_dLT`, where `z` is the service-level z-score and `σ_dLT` is the std dev of demand over the lead time.
- **Reorder point = expected demand over lead time + safety stock.** Recommend ordering up to (or above) the upper prediction interval to avoid stockouts.
- Optional **EOQ** = `√(2DS/H)` when the product has order cost `S` and holding cost `H`.
- **Storage & shelf-life constraints (optional, per product):** when a product has `storage_capacity`, never recommend ordering beyond what fits. When it has `shelf_life_days`, never recommend ordering more than can realistically sell before spoilage (cap the order at forecast demand over the shelf-life window). If neither is set, ordering advice is unconstrained. Surface a plain-language note when a constraint is binding ("capped at 200 — your storage limit").

## 7. Formula catalog

### Demand forecasting
- **Simple moving average** — mean of the last *n* observations.
- **Weighted moving average** — weighted mean of the last *n*, weights summing to 1, most recent heaviest.
- **Exponential smoothing** — `F_t+1 = αA_t + (1−α)F_t`, with 0 < α < 1.
- **Holt-Winters (triple exponential smoothing)** — level (α), trend (β), seasonal (γ). Likely the primary engine.
- **Linear regression / trend projection** — fit `y = a + b·t`; these are the *same* technique (time as the predictor), so treat as one tool, not two.
- **Seasonality index** — `index_d = average(day d) / overall average`; multiply a base forecast by the index.
- **ARIMA** — *Phase 3 / advanced only.* Powerful but easy to over-fit on ~1 year of daily data and hard to auto-tune; not worth the fragility in the MVP.

### Forecast accuracy (drives the self-correcting weights)
- **Forecast error** — `actual − forecast`.
- **MAD** — mean of |error|.
- **MSE** — mean of error² (penalizes big misses).
- **MAPE** — mean of |error| / actual, as a %. Most intuitive for owners ("off by 11%"). Caveat: undefined/explodes when actual ≈ 0 (closed days) — exclude those.
- **Tracking signal** — running sum of errors ÷ MAD. If it drifts past about ±4, the forecast is biased and the model should be recalibrated. Pairs perfectly with the self-correction theme.
- **Coefficient of variation** — std dev ÷ mean of demand; tells the owner how predictable the business is.

### Ordering (the "how much to order" output)
- **Reorder point**, **safety stock**, **service-level z-score**, optional **EOQ** — see section 6.

### Capacity & queueing (Phase 3 — a separate question from demand)
These answer "given the demand, are my registers/staff enough and how long do people wait?" — distinct from "how many customers."
- **Little's Law** — `L = λ · W` (avg number in system = arrival rate × avg time in system).
- **Throughput** — units/customers served per unit time.
- **Bottleneck capacity** — the slowest stage caps the whole system.
- **Utilization** — `λ / (servers × μ)`, where μ is service rate per server.
- **Queue / waiting time** — M/M/1 and M/M/c expected wait and queue length; pairs with the busiest-hour feature to suggest how many registers to open at peak.
- **Staffing per shift** — using the hourly arrival rate (λ) from tap-captured data and the average service time per customer, find the smallest number of servers/registers `c` that keeps utilization below a safe threshold (and expected wait under a target). This turns the queueing math into a plain answer: "for the 5–6pm rush, schedule 3 people." Depends on Phase 1.5 transaction capture for the hourly λ.
  - **Service time is per-product, not one flat average.** Each business has a **default average service time**, but individual products/services can **override** it (e.g. a spa: massage = 60 min, express service = 10 min; a café might just use the default). Staffing math must weight by the **actual product mix sold in each hour**, not a blanket average — otherwise a mix of long and short services gives misleading advice. Keep the simple case simple: a business that doesn't set per-product times just uses the default for everything.
  - **Marginal-worker value (owner-requested):** show the owner what *adding or removing one worker* does — e.g. "adding a 3rd person at 5–6pm cuts the average wait from 8 min to 3 min." This is the queueing math run at c and c±1 and compared, so a hire/scheduling decision is concrete. Pair with showing the **expected wait time / queue length** at current staffing, derived from the average arrival and service rates.

## 8. Event / ad effectiveness method

Do not compare raw sales during a promo to a random baseline. Instead: have the trained model forecast what *would* have happened with no event (the normal baseline), then report **actual − baseline = lift** over the period, ideally with a confidence range. This reuses the forecasting engine and yields a defensible "this ad brought ≈ +18% over baseline" figure. If the `Period` has a cost, also report lift per unit cost.

## 9. Data-sufficiency rules (set expectations in the UI)

- Day-of-week patterns: need ≈ 2–4+ weeks before forecasts are trustworthy.
- Hourly patterns (Phase 3): need ≈ 2–4 weeks of hourly entries.
- Annual seasonality: realistically needs ≈ 2 years — most users won't have it, so make it a "someday" feature, not a Phase-1 promise.
- Always surface a clear "not enough data yet — keep logging" state instead of a misleading number.
- **A missing day means "no data," never "zero customers."** Days the owner simply didn't log must be ignored by the engine, not counted as zero — otherwise gaps drag forecasts down. Combined with opening-days settings: closed days are expected-absent and excluded; open days with no entry are treated as missing data, not zero.
- **Entry-timing rules (owner-requested data integrity):** do not allow logging or editing *today's* totals while the business is still open / the day hasn't finished, and do not allow live input outside opening hours — this keeps a day's data from being recorded half-complete. **Exception:** genuinely past days remain editable via the manual backfill screen. So the rule is "don't record a day that isn't finished or isn't within open hours," not "never touch history."
- **Show progress toward reliability.** Display how many days/weeks have been logged and, when below the thresholds above, a friendly "log about N more days for reliable forecasts" message — so the owner understands *why* a forecast is or isn't shown yet, rather than guessing.

## 10. Free vs premium gating

**Premium lifts limits; it does not unlock features.** All users get the full feature set (hourly, busiest-hour, staffing, monthly view, queueing, full forecasting). The difference is caps only:
- **Free:** history capped (~6 months to 1 year); limited number of logged ads/events (e.g. 2 active); otherwise the complete app.
- **Premium:** extended/unlimited history; more/unlimited ads/events; (future) POS integrations.
- Enforce caps **server-side** (never only in the client). Implement as a simple per-account tier flag plus limit checks. Billing itself is deferred (Phase 3.5) — build the gating now, charge later.

## 11. Engineering conventions

- The `engine/` package is **test-driven**: every formula gets a known-answer unit test (section 12) before or alongside implementation. Textbook ops problems have exact answers — use them.
- Keep route handlers thin: validate input, call the engine, shape the response. No math in handlers.
- Keep forecasting logic out of the frontend entirely (so mobile inherits it for free).
- Strong typing both sides: Pydantic in Python, TypeScript in the clients.
- Store forecasts when made (ForecastRun) so accuracy is measured against what was *actually* predicted, not recomputed after the fact.

## 12. Known-answer test cases (seed the test suite with these)

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
- **EOQ**, D=10000, S=50, H=2 → `√(2·10000·50/2) ≈ 707`.

## 13. Open decisions to confirm

- Phase 1 has **no login** (single local user) to validate forecasting fast — confirm that's acceptable.
- ~~Auth provider for Phase 2~~ **DECIDED:** Supabase (managed auth + Postgres in one). Do not hand-roll password security.
- Web charting library (Recharts vs Chart.js) — minor; Recharts assumed.
- Exact free-tier limits and premium price point.
- **Wrong-forecast handling:** when actuals diverge from predictions, the self-correcting ensemble (section 2) should down-weight the models that missed and the tracking signal should flag sustained bias. Worth explicitly testing this behaves well once there's real data — simulate a demand shift and confirm the weights and intervals adapt sensibly.

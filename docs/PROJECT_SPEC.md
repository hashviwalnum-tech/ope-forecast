# Operations Forecasting App — Project Specification

> Detailed blueprint. The root `CLAUDE.md` is a short pointer to this file. Update this doc as decisions change; treat it as the source of truth for scope and design.

## 1. Vision

**Ope is a neutral, trusted decision tool for variable-demand small businesses — one the owner teaches over time, and that gets stickier the more it's used.** The owner records what sells (end-of-day totals or, better, a tap per sale), and Ope turns that data — *plus the owner's own knowledge of their world* — into concrete decisions: how much of each product to order, how many staff to schedule, whether an ad/event paid off, and alerts when the pattern is drifting. Forecasting customers is the *engine*, not the headline.

**Strategic reframe (decided after stress-testing the idea — see §1.6):** raw "predict how many customers" has a value-decay problem — for an established business, demand settles into a band the owner soon knows by heart. The durable value is in the things that keep changing or that humans hold poorly in their heads: **per-product ordering, staffing, and detecting *change* (drift/anomalies)** — i.e. *decisions and change-detection*, not the prediction itself. Target customers are **variable-demand businesses** (cafés, restaurants, florists, grocers, bakeries), not stable-staple retailers (a hardware store with standing orders gains little).

**End-state:** a mobile app and/or an extension that plugs into smart registers (POS), which already emit time-stamped transactions. Designing around live per-transaction data now (§5) means the data model already matches what a register provides, so integration later is a natural fit, not a rewrite.

## 1.6 Strategic positioning & moat (decided)

The forecasting math is textbook and copyable; there is **no technological moat**. Defensibility comes from:
1. **Neutrality / POS-agnosticism** — incumbents (Square, Toast, Lightspeed, Clover) lock owners into their own ecosystem and can't follow Ope across systems. Ope works across registers, spreadsheets, and manual entry; an owner who switches POS keeps Ope. *This is a structural moat the incumbents cannot copy.* Prioritize integration breadth and never assume a single data source.
2. **Accumulated taught-context** — the longer an owner teaches Ope their world (recurring events, anomalies to ignore, their regulars, a customized home), the more painful leaving becomes. Personalized configuration = switching cost. Weak early, strong over time.
3. **Niche focus + trust** — own "the calm, trusted tool for small *variable-demand* businesses." Incumbents go broad and generic; Ope goes deep and beloved for a segment.
4. **Workflow embedding via the decision layer** — become where owners *make and track* ordering/staffing/promo decisions, not just view charts.

**Core design philosophy — human + machine (the owner knows the world):** Ope advises and computes; the owner knows context a model never will (rain Saturday, a festival, a regular on holiday). The app must always let the owner **override, teach, and correct** it — mark events, flag/ignore flukes, declare recurring patterns — and must never arrogantly replace local knowledge. An app that overrides the owner's context will be wrong and abandoned. Every feature should ask: *does this deepen neutrality, or the owner's investment in their own configuration?*

**Honest scope limits (accepted):** ordering value is weaker for staple/contracted goods (owners already have standing supplier orders) and strongest for perishable/variable items — reinforcing the variable-demand target. "Premium = more data limits" is a thin reason to pay; premium is being reshaped toward genuinely ongoing value (§10).

## 1.5 Product identity, branding & design language

- **Name:** **Ope**.
- **Slogan:** "Know Tomorrow, Today."
- **Logo:** the provided "OPe" mark in blue with a green accent (stored in the repo under `web/src/assets/`). Use it in the header and as the favicon.
- **Audience:** owners of *small* businesses, not large companies. Many are adults who are not comfortable with technology (potential technophobes). This drives every UX decision below.
- **Design language — calm, comfortable, inviting:**
  - **Palette:** soft blue-green, relaxing rather than corporate or high-contrast. Blue as the primary, green as the accent (matching the logo). Plenty of whitespace, gentle rounded corners, no harsh pure-black-on-white.
  - **Plain language everywhere:** no jargon in the UI. Say "How busy will tomorrow be?" not "Forecast horizon"; "You'll likely need this much" not "Reorder point = …". Keep statistical terms (MAPE, tracking signal) in an optional "details" area, not the main view.
  - **Big, obvious controls:** large tap targets, clear single primary action per screen, readable font sizes. Assume a nervous first-time user on a phone.
  - **Palette — calm but alive, with depth (corrected again):** the original was too bright; a pass overcorrected to grey/washed-out; the header and body ended up the *same* shade. Fix: soft, low-saturation teal/blue-green with warmth (not grey, not clinical); **the top/header row should be a brighter shade of the lower body** (clear but gentle contrast between them); backgrounds and ad-slot/bottom areas use a **soft tint, never pure white**. Consistent across all screens.
  - **Home screen layout (ordered, top to bottom) — "what do I need right now":** one switchable analytics block (see below) at top alongside quick actions, then supporting cards. The single chart should switch between **Week prediction / Demand forecast / What to order** (these are views of the same thing, not separate cards), with **customers as just one selectable series** alongside each product (show one series at a time; don't overlay mismatched scales).
    1. **Quick actions** (Record a sale, Log today, Record a regular) — MOST prominent, at the very top.
    2. The **switchable forecast/order chart** (week prediction ↔ demand-by-product ↔ what-to-order).
    3. **Busy hours** — **tomorrow's** (today is already in motion and not actionable), then a **peak-hours-by-weekday forecast**. Slightly less upfront.
    - **Remove from default home:** "your typical week" and "how is the app doing." **Move "how our predictions did" into the Manage menu** (a review tool, not a right-now decision).
  - **Home is user-customizable (owner-knows-best):** the owner can choose **which cards appear on home and in what order**. Copy the current/default home composition into its own **"Predictions" tab** so nothing is lost, and let home be reconfigured. Defaults follow the order above for new users.
  - **Ad slots:** widen and **lengthen** the side slots to use more edge space (currently too short/narrow); keep them tinted (not white) and non-intrusive.
  - **Information architecture — focus on the short term first, nest the rest.** Top level had ~11 buttons (overwhelming). Lead with immediate essentials; group everything else (settings, products, past-data, history, analytics depth, the advanced toolbox in §7.5) behind fewer, clearly-labelled entry points.
  - **Guidance over blank slates:** short helper text, sensible defaults, friendly empty/"not enough data yet" states.
  - **Forgiving:** easy undo, confirm before anything destructive, never punish a wrong tap.
  - **Localization:** support multiple languages; **add Hebrew** alongside English (right-to-left aware where needed).

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

### Phase 3 — Decisions, trust & polish (reframe-driven build order)
**This phase makes Ope genuinely good and durable, per §1.6.** The owner chose "reframe drives priority": build moat/teaching/integrity first, treat raw-forecasting polish as good-enough, do cosmetics last. **Build order (tiers):**

**Tier 1 — Forecasting integrity (foundation; verify before anything sits on it).** These have been mis-implemented repeatedly, so approach **diagnostic-first** (trace where it breaks, prove it with a test, then fix):
- Missing/unlogged day ≠ zero; closed/non-working days excluded; outlier detection (relative, flag-and-ask, never silent-delete); keep alerting on large day-to-day range unless explained or consistently recurring. (See §6 CRITICAL INTEGRITY RULES.)
- This doubles as the start of **change-detection** (drift/anomaly alerts), a core durable-value output.

**Tier 2 — Teaching / context features (the taught-context moat).**
- Recurring/permanent events (RecurringPattern) — declarable, folded into forecasts, not flagged as anomalies.
- Regulars + CLV — separate entity & data, "Record a regular" action, never in past-data.
- Anomaly/event marking working properly (owner teaches ignore/expect).
- Home-page customization + copy current home into a **"Predictions" tab**.

**Tier 3 — Decision depth + data-integrity guards.**
- Per-product forecasting & order *quantity*; capacity + shelf-life constraints (NOT cost); per-product service time feeding the wait-line.
- Whole-vs-decimal units (input AND output).
- Erase product; price field.
- Entry-timing rules: block logging/editing today before close & outside open hours & on non-working days; tap-only days roll into past-days after close; no duplicate past-day entry.
- Hebrew language.

**Tier 4 — Look (polish last, on stable structure).**
- Header a brighter shade than the body; one switchable forecast/order chart (week ↔ by-product ↔ what-to-order); taller/wider tinted ad slots; finish the calm-but-alive palette.

**Tier 5 — Strategic / longer-horizon (naturally later, partly post-beta).**
- Multi-location (premium) + copy settings/products (not data).
- Advanced/planning toolbox (§7.5) — isolated, plain-language.
- Deeper POS-integration readiness (the neutrality moat).

*Business-logic login fix (auto-load business, never re-prompt/lock-out, allow adding businesses) — DONE.* Premium *limits* gating per §10 layers in around Tier 3–5; **billing deferred to Phase 3.5.**

### Phase 3.5 — Monetization (deferred until real users)
- **Subscription billing** (Stripe on web) layered onto the premium-limit gating.
- **Ad placement** — slots already reserved in Tier 4. **Placement rules (non-negotiable for trust):** never pop-ups, never overlapping/covering content, never interrupting. Wide screens: tinted side-margin slots; narrow screens: one slim tinted bottom banner outside content. Always visually separated from app content. **Removing ads is a premium perk.**
- For mobile, App Store / Play in-app purchases are usually **required** for digital subscriptions (15–30% cut, own rules) — design the premium flow with that in mind.

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
- **Product** — id, business_id, name, **price (optional, in optional details)**, current_stock (optional), lead_time_days, **optional service_time_minutes (overrides the business default for staffing math — MUST be exposed in the product add/edit UI under optional details, defaulting to the business setting when blank)**, **optional storage_capacity / capacity (max units that physically fit)**, **optional shelf_life_days (spoilage)**, **unit_mode ('whole' | 'decimal', default 'whole')**. Capacity and shelf-life are **optional, off by default** — the app must work cleanly when neither applies (clothing has no shelf life; a warehouse has effectively no cap). When present they constrain ordering advice (see Ordering bridge). **unit_mode controls counting AND forecast output: default whole means quantities and predictions are always whole numbers (never "order 45.3"); decimal mode (e.g. kilos of cheese) allows fractional input and output.** Products must be **quick to add, edit, and delete** (erase-product is required). A fast "add product" flow is a Phase-1.5 priority.
- **SaleEvent** *(mode B — live capture)* — id, business_id, product_id (nullable — a tap can record "a customer" with no specific product), timestamp, quantity (default 1; respects the product's unit_mode), optional unit_price. The raw transaction stream; foundation for hourly/staffing and POS integration.
- **DayRecord** *(mode A — daily totals, or the daily roll-up of SaleEvents)* — id, business_id, date (**unique per business — the app must REFUSE to create a second past-day entry for a date that already exists; offer to edit the existing one instead**), customers (int), notes.
- **SaleRecord** *(mode A)* — id, day_record_id, product_id, units_sold.
- **HourRecord** *(derived / analytics)* — id, business_id, date, hour (0–23), customers, units_sold. Rolled up from SaleEvents; powers busiest-hour and staffing.
- **Period** — id, business_id, start_date, end_date, type ('event' | 'ad'), label, optional cost, **recurring flag + recurrence rule (optional)**. One-off OR recurring (see RecurringPattern). Excluded from the "normal" baseline; recurring ones are folded back in as expected (see §6).
- **RecurringPattern** *(owner-taught context — a moat feature)* — id, business_id, label, weekday(s), optional hour range, effect (e.g. "higher"). For predictable repeating bumps the owner knows about — e.g. "a school trip every Sunday 9–11am." The engine must **treat these as expected (fold into the forecast for that weekday/hour), NOT flag them as anomalies.** This is the owner teaching Ope their world.
- **Regular** *(separate entity & data store — NOT in past-data/demand history)* — id, business_id, name, visit_frequency (e.g. per week), avg_spend, derived **CLV** (Customer Lifetime Value, computed from frequency × spend × expected lifespan), optional ongoing tracking. Edited on a dedicated screen (enter frequency + spend → auto-CLV). A separate **"Record a regular"** quick action (distinct from "Record a sale") logs a regular's visit, building an observed frequency over time. **Regulars live in their own data; they never enter DayRecord/SaleEvent demand history.** (Auto-identification per transaction is out of scope until POS/loyalty data exists; the manual version ships now.)
- **ForecastRun** (recommended) — id, business_id, created_at, target_date, predicted value, interval low/high, model weights used. Lets accuracy be measured against what was actually predicted.

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

**CRITICAL INTEGRITY RULES (these have repeatedly been mis-implemented — they must actually work end to end, verified by tests):**
- **A missing/unlogged day is NOT zero.** It must be excluded from averages, never counted as 0 customers/units. Symptom of the bug: the app forecasting 0 for a product on some weekday because absences were averaged in as zeros. A forecast must never be dragged down by days that simply weren't recorded.
- **Closed days / non-working days are excluded entirely**, not treated as zero.
- **Outlier detection relative to the business's own pattern, never fixed thresholds.** A day is a candidate outlier if far outside the normal spread for that weekday — ~3 std devs from that weekday's mean, or a robust median ± k·MAD (better with several odd days). Scales automatically (kiosk vs supermarket).
- **Flag and ask — never silently delete.** A spike is often real (holiday, viral day, competitor closed). Prompt in plain language ("Sunday looks unusually high — one-off, or a real event?"); the owner chooses: mark event/ad, exclude as fluke, keep, or **mark as a recurring pattern** (RecurringPattern — then it's expected, not flagged again). Down-weight un-reviewed outliers; never fully discard silently.
- **Keep alerting on large day-to-day range** *unless* the owner has explained it (event/ad/recurring) **or it recurs consistently** (then the engine learns it as the pattern, not noise).

**Change-detection (a core, durable-value output — see §1.6):** beyond predicting the steady state, Ope must **flag when the steady state breaks** — sustained drift (e.g. "down ~8% over 3 weeks"), an unusually weak/strong day, or a regime shift. Humans are poor at noticing slow drift; this is where lasting value lives. Surface these as plain-language alerts. (The tracking signal in §7 is one mechanism.)

**Pipeline additions:** recurring patterns (above) are folded into the relevant weekday/hour as expected demand before anomaly checks run.

**Per-product demand forecasting (core, currently a gap to fill):** forecast demand **per product**, not only total customers (e.g. "order ~40 oranges"). Each product's unit-sales history feeds the same engine. **Present as ONE shared, switchable chart** that toggles between Week-prediction / Demand-by-product / What-to-order, with total customers as just one selectable series (show one series at a time). Respect each product's `unit_mode` (whole vs decimal) in the output. **When a product has enough detail (capacity, usual sales, lead time), surface the recommended order *quantity* ("order ~40"), not just the reorder *trigger*.**

**Ordering bridge** (this is what turns a forecast into a decision):
- Expected demand over lead time = forecast summed across the next `lead_time_days`.
- Safety stock = `z × σ_dLT` (`z` = service-level z-score; `σ_dLT` = std dev of demand over lead time).
- **Reorder point = expected demand over lead time + safety stock.** Recommend ordering up to (or above) the upper prediction interval to avoid stockouts; round per `unit_mode`.
- **Constraints use CAPACITY and SHELF-LIFE, not abstract cost** (owners don't know "holding cost per unit", but they know *how much fits* and *how fast it spoils*). When `capacity` is set, never recommend beyond what fits. When `shelf_life_days` is set, never recommend more than can sell before spoilage (cap at forecast demand over the shelf-life window). Surface a plain note when a cap binds ("capped at 200 — your storage limit"). If neither is set, ordering is unconstrained.
- **EOQ is de-emphasized** — it needs order/holding costs most small owners can't supply; offer it only as an advanced option, never a required input.
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

### Customer value
- **CLV (Customer Lifetime Value)** — for a tracked **Regular**: roughly `visit_frequency × avg_spend × expected_lifespan` (with margin if known). Computed automatically when the owner enters a regular's frequency and spend; refined by observed visits if they use "Record a regular." Lives in the separate regulars data, never in demand history.

### Capacity & queueing (a separate question from demand)
These answer "given the demand, are my registers/staff enough and how long do people wait?" — distinct from "how many customers."
- **Little's Law** — `L = λ · W` (avg number in system = arrival rate × avg time in system).
- **Throughput** — units/customers served per unit time.
- **Bottleneck capacity** — the slowest stage caps the whole system.
- **Utilization** — `λ / (servers × μ)`, where μ is service rate per server.
- **Queue / waiting time** — M/M/1 and M/M/c expected wait and queue length; pairs with the busiest-hour feature to suggest how many registers to open at peak.
- **Staffing per shift** — using the hourly arrival rate (λ) and average service time, find the smallest number of servers `c` that keeps utilization below a safe threshold (and wait under target): "for the 5–6pm rush, schedule 3 people." Depends on transaction capture for hourly λ.
  - **Service time is per-product, not one flat average.** Business has a **default**; products can **override** (spa: massage 60 min, express 10 min; a café may just use the default). Staffing math weights by the **actual product mix sold in each hour**, not a blanket average. The per-product field must be exposed in the product UI and feed the wait-line calc.
  - **Marginal-worker value:** show what adding/removing one worker does ("a 3rd person at 5–6pm cuts the wait from 8 to 3 min") — queueing run at `c` and `c±1`, compared. Also show the **expected wait time / queue length** at current staffing.

### 7.5 Advanced / planning toolbox (isolated, plain-language, its own section)
Power-user tools, kept in a **separate "advanced/planning" area** and surfaced in **plain language, never as jargon** (a florist wants "should I order more given it might rain?", not "apply the Hurwicz criterion"). Most owners never open this; power users (and the home-customization feature) can pull pieces forward. Include:
- **Decision theory under uncertainty** — Hurwicz (optimism-pessimism) criterion, maximin/maximax, expected value; framed as "best/worst/likely case" choices.
- **Behavioral framing** — prospect theory (Kahneman–Tversky) awareness, e.g. loss-aversion-aware nudges around stockouts vs waste.
- **Linear programming (LP)** — simple optimization (e.g. allocate limited budget/space/staff across products to maximize expected profit subject to constraints).
- **Basic planning / project-management components** — lightweight scheduling/planning helpers.
These are clearly later-tier and must not bloat or intimidate the core experience.

### Forecast accuracy (drives the self-correcting weights)
- **Forecast error** — `actual − forecast`.
- **MAD** — mean of |error|.
- **MSE** — mean of error².
- **MAPE** — mean of |error| / actual, as %. Intuitive ("off by 11%"). Exclude near-zero/closed days.
- **Tracking signal** — running sum of errors ÷ MAD; past ±4 → biased, recalibrate. Also a **change-detection** signal (§6).
- **Coefficient of variation** — std dev ÷ mean; how predictable the business is.

### Ordering (the "how much to order" output)
- **Reorder point**, **safety stock**, **service-level z-score**; constraints via **capacity & shelf-life** (not cost). EOQ advanced-only. See §6.

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

**Premium lifts limits / unlocks scale; the core decision tools stay free for everyone** (hourly, busiest-hour, staffing, change-detection, ordering, regulars/CLV, recurring patterns, full forecasting). Decided split:

**Premium:**
- **Multiple locations** — free = **one** business/location; premium = more. Include a **"copy settings & products to a new location"** action (copies configuration, **NOT the data/history** — each location's history is its own).
- **Extended history** — free history capped (~**1 year**); premium = more/unlimited.
- **More ads** — ads remain the premium-gated action: free gets a limited (but somewhat expanded) number of **ads**; premium = more/unlimited.
- (future) POS integrations.

**Free (generous / not gated):**
- **Events** — no longer premium-gated the way ads are; give free users an **expanded allowance of one-off events**. **Recurring/consistent events (RecurringPattern) are always free** — they're core owner-taught context.
- All analytics, ordering, staffing, change-detection, regulars/CLV, the advanced toolbox basics.

- Enforce caps **server-side** (never only client). Simple per-account tier flag + limit checks. **Billing is deferred (Phase 3.5)** — build the gating now (with a manual way to set an account premium for testing), charge later.
- *Note the §1.6 caution:* limits alone are a thin reason to pay; the multi-location and extended-history value, plus future deep features, are what should justify premium. Revisit pricing/value after beta.

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

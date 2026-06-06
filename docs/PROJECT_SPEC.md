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
  - **Home is fully user-customizable — ALL charts, not just Predictions:** EVERY chart and card anywhere in the app (forecasting, hourly, ordering, staffing, accuracy, etc.) must have an **"Add to home"** option. Once a chart is already on home, that button must change to **"Remove from home"** (or disappear) — it must NOT keep showing "Add to home" for a chart that's already added. The home screen is then fully **reorganizable** (drag to reorder). The current default home layout is copied into a **"Predictions" tab** so defaults are preserved; home starts from those defaults for new users.
  - **Week prediction is NOT a separate card** — it is one view of the demand chart. The single switchable chart toggles demand-by-series ↔ what-to-order. Any standalone "week prediction" card is redundant and must be removed.
  - **Ad slots** must be tall enough to fill the side margins meaningfully (currently too short). Stretch them vertically to use the available edge space without covering content; keep them tinted, never white.
  - **Record a Sale — short plain explanation:** show a brief note next to the tap screen, e.g. "Tap once for each customer, then tap what they bought and how many."
  - **Dark mode:** full dark-mode support, toggleable in settings (or follows system preference). All screens, charts, and cards must render correctly in both modes.
  - **Logo:** use a **transparent-background PNG** (no white or colored box behind the logo). Owner must supply the file; Claude Code places it. If not available, use remove.bg or the original source.
  - **Information architecture:** lead with immediate essentials; group everything else (settings, products, past-data, history, analytics depth, advanced toolbox) behind fewer, clearly-labelled entry points.
  - **Guidance over blank slates:** short helper text, sensible defaults, friendly empty/"not enough data yet" states.
  - **Forgiving:** easy undo, confirm before anything destructive, never punish a wrong tap.
  - **Localization completeness — durable approach, not repeated patching.** Hebrew strings keep reverting because each fix only catches some strings and CHART labels are handled separately from normal UI text. Fix the system, not the symptom: (1) route ALL user-facing strings through one central translation source — including **chart/graph labels, axis titles, legends, tooltips, and any series names** (Recharts labels and data-derived labels must be translated explicitly, since they bypass the normal text path — this is the stubborn part); (2) make untranslated strings **detectable** (e.g. a dev check or fallback marker) so a missing translation is obvious rather than silently showing English; (3) cover recently-added features (Telegram panel, locations, regulars, charts). This is not heavy work — it's light but must be done centrally so it stays fixed.

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

**Telegram bot (a client of the Ope API — integration & moat feature):** lets owners log sales and ask for forecasts/orders in plain language. It's an **agent**: an LLM receives the message, chooses among tools (`log_sale`, `get_forecast`, `get_order_recommendation`), each tool calls the Ope API, and the LLM replies plainly. Real-data (production) architecture:
- **Account linking:** each Telegram user has a unique `chat_id`. The owner generates a **one-time link code** in the web app and sends it to the bot once (`/link CODE`); the backend stores a **TelegramLink** (chat_id ↔ business_id), revocable from the web app. The bot never handles user passwords.
- **Service auth:** the bot is a trusted server-side caller holding a **bot service key** (shared secret). It calls dedicated backend endpoints that trust that key and scope every request to the linked business_id. Never reuse human login tokens in the bot.
- **Tools call the real Ope API** (Render backend) and return that business's real data — not stubs.
- **LLM provider swappable** behind a small abstraction (paid API / Gemini / local Ollama) so the model can change without touching tool logic.
- New table **TelegramLink** (id, business_id, chat_id, created_at); new endpoints: generate-link-code, redeem-link-code, and service-authed tool endpoints.

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
- **CSV import improvements:** (1) the template's instruction/example row (row 2) must be **skipped on import**, not parsed as data — currently it's misread as a date and errors. (2) When hourly columns are present, **auto-sum them into the daily total** (consistent with the hours-vs-total rule above). (3) Import is **slow and may not reliably complete** — make it performant and confirm it actually finishes (show clear success/failure, not a silent hang). Validate rows and report which rows (if any) couldn't be read, rather than failing the whole import.
- **Manual entry / backfill screen** — a dedicated screen to add or correct a *specific past day*, separate from "Add Today." Use a **date picker (clickable calendar)**, never a free-text date field, so there is zero date-format ambiguity. The current workaround of changing the date inside "Add Today" is not acceptable as the only option — past-data entry must be a clear, comfortable, first-class feature. **By default this captures daily totals only** (most owners won't recall hourly breakdowns for past days), but offer an **optional way to add hourly detail** for a past day when the owner does have it — e.g. from smart-register logs. This is the same hourly shape POS integration will later import automatically, so building the capability now is forward-compatible. **The CSV import template must also support optional hourly columns**, so bulk history with hours (e.g. register exports) can be imported, not just daily totals.
- **CSV import** — for bulk history. Date handling must be robust: accept common formats, and **show the user how each date was interpreted before saving** (a preview), so DD/MM vs MM/DD confusion and Excel's auto-reformatting can't silently corrupt data. The on-screen example must actually match the stated expected format. Consider accepting ISO `yyyy-mm-dd` as canonical but tolerating others with the confirmation preview.

**Input mode B — live transactions (going forward, and what registers emit):** the owner taps a product button the instant a customer buys it ("just sold bananas" → tap). Each tap is stored as a time-stamped event. This is the richer source: because every sale carries a timestamp, the **hourly view, busiest-hour analysis, and staffing recommendations all derive automatically from this same data** — no separate hourly data entry needed. It also mirrors exactly what a smart register produces, lining up with the end-state.

**Aggregation:** the engine always reads **daily (and, when available, hourly) aggregates**. Those aggregates are either typed directly (mode A) or rolled up automatically from transactions (mode B). The forecasting engine doesn't care which mode produced them — keeping the two input paths cleanly separated from the math.

### Entities
- **Business** — id, name, settings (opening days/hours, default lead time, target service level, average service time per customer for staffing). One row in Phase 1; FK to user in Phase 2. **Opening days/hours must be editable in a settings screen** — and the forecasting engine must use them: closed days are excluded from forecasting entirely (not treated as zero-customer days), and hourly features only consider open hours.
- **Product** — id, business_id, name, **price (optional, in optional details)**, lead_time_days, **optional service_time_minutes (overrides the business default for staffing math — exposed in the product add/edit UI under optional details, defaulting to business setting when blank)**, **optional capacity (max units that physically fit — NOT "storage cost", that field must NOT exist)**, **optional shelf_life_days (spoilage)**, **unit_mode ('whole' | 'decimal', default 'whole')**. Capacity and shelf-life are **optional, off by default** — app must work cleanly when neither applies. When present they constrain ordering advice (see §6). **unit_mode controls counting AND forecast output: whole = always whole numbers ("order 45", never "45.3"); decimal = fractional input/output.** (This has regressed twice — decimals reappearing for whole-unit products. Add a guarding test so a whole-unit product can never produce a fractional forecast or order quantity, and it stays fixed.) For decimal products, the tap-to-record screen must show an **editable tap-unit field** next to the button (e.g. "0.5 L / 0.1 L / 1 L") so the owner can adjust what one tap represents. Products must be **quick to add, edit, and DELETE** — erase-product is required and must actually work. **There is NO holding_cost and NO order_cost field — do not add or retain these. EOQ is advanced-only and must not require cost inputs from the user.**
- **SaleEvent** *(mode B — live capture)* — id, business_id, product_id (nullable — a tap can record "a customer" with no specific product), timestamp, quantity (default 1; respects the product's unit_mode), optional unit_price. The raw transaction stream; foundation for hourly/staffing and POS integration.
- **DayRecord** *(mode A — daily totals, or the daily roll-up of SaleEvents)* — id, business_id, date (**unique per business — the app must REFUSE to create a second past-day entry for a date that already exists; offer to edit the existing one instead**), customers (int), notes.
- **SaleRecord** *(mode A)* — id, day_record_id, product_id, units_sold.
- **HourRecord** *(derived / analytics)* — id, business_id, date, hour (0–23), customers, units_sold. Rolled up from SaleEvents; powers busiest-hour and staffing.
- **Period** — id, business_id, start_date, end_date, type ('event' | 'ad'), label, optional cost, **recurring flag + recurrence rule (optional)**. One-off OR recurring (see RecurringPattern). Excluded from the "normal" baseline; recurring ones are folded back in as expected (see §6).
- **RecurringPattern** *(owner-taught context — a moat feature)* — id, business_id, label, weekday(s), **optional start-hour, optional end-hour** (if end-hour not set, the engine infers the extent from the data), effect (e.g. "higher"). For predictable repeating bumps the owner knows about — e.g. "a school trip every Sunday 9–11am." The engine must **treat these as expected (fold into the forecast for that weekday/hour), NOT flag them as anomalies.** Both start and end hour should be settable; if only start is set, pattern applies to that hour; if both are set, it spans the range.
- **Regular** *(separate entity & data store — NOT in past-data/demand history)* — id, business_id, name, **first_visit_date**, avg_spend_per_visit, derived **CLV** (auto-computed), optional notes. Edited on a dedicated screen. **"Record a regular" logs ONE record per regular per day**, holding that day's running total spend. **It must be editable (additive) during open hours** — e.g. Sarah spends $20 at noon (logged), then $10 at 3pm → the owner edits today's entry to $30; this is the meaning of "record a visit twice." The day's total **locks after closing hours** (then it's final). Current bug: recording/editing a same-day regular visit is blocked — it must allow updating today's total. **Recording/editing a regular is allowed any time during open hours** (point-event, exempt from the sales entry-timing rule). Regulars never enter DayRecord/SaleEvent demand history.
  - **Regular profitability chart:** show how much a regular has earned the business over **this month, this year, and since first arrival** (using first_visit_date). This is CLV made visual.
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
- **Outlier detection uses IQR (interquartile range) — the standard, robust method — NOT a tight std-dev rule.** The current detector is far too sensitive (it flagged 43 customers against a ~54 average, which is completely normal variation). Replace it with: compute Q1 and Q3 of that weekday's history, IQR = Q3−Q1, and flag a day only if it falls below `Q1 − 1.5·IQR` or above `Q3 + 1.5·IQR` (the conventional Tukey fences; use 3·IQR for "extreme"). This must be evaluated **per weekday** against that weekday's own distribution, and must NOT fire on ordinary day-to-day fluctuation. A value within normal weekly variance is never an outlier. Needs enough history (several same-weekday points) before flagging at all.
- **Flag and ask — never silently delete.** A spike is often real (holiday, viral day, competitor closed). Prompt in plain language ("Sunday looks unusually high — one-off, or a real event?"); the owner chooses: mark event/ad, exclude as fluke, keep, or **mark as a recurring pattern** (RecurringPattern — then it's expected, not flagged again). Down-weight un-reviewed outliers; never fully discard silently.
- **Keep alerting on large day-to-day range** *unless* the owner has explained it (event/ad/recurring) **or it recurs consistently** (then the engine learns it as the pattern, not noise).

**Change-detection (a core, durable-value output — see §1.6):** beyond predicting the steady state, Ope must **flag when the steady state breaks** — sustained drift (e.g. "down ~8% over 3 weeks"), an unusually weak/strong day, or a regime shift. Humans are poor at noticing slow drift; this is where lasting value lives. Surface these as plain-language alerts. (The tracking signal in §7 is one mechanism.)

**Pipeline additions:** recurring patterns (above) are folded into the relevant weekday/hour as expected demand before anomaly checks run.

**Per-product demand forecasting (core, currently a gap to fill):** forecast demand **per product**, not only total customers (e.g. "order ~40 oranges"). Each product's unit-sales history feeds the same engine. **Present as ONE shared, switchable chart** that toggles between Week-prediction / Demand-by-product / What-to-order, with total customers as just one selectable series (show one series at a time). Respect each product's `unit_mode` (whole vs decimal) in the output. **When a product has enough detail (capacity, usual sales, lead time), surface the recommended order *quantity* ("order ~40"), not just the reorder *trigger*.**

**Ordering bridge** (this is what turns a forecast into a decision):
- Expected demand over lead time = forecast summed across the next `lead_time_days`.
- Safety stock = `z × σ_dLT` (`z` = service-level z-score; `σ_dLT` = std dev of demand over lead time).
- **Reorder point = expected demand over lead time + safety stock.** Recommend ordering up to (or above) the upper prediction interval to avoid stockouts; round per `unit_mode`.
- **Constraints use CAPACITY and SHELF-LIFE only — never cost** (holding cost and order cost fields must NOT exist anywhere in the UI or database — remove them if present). When `capacity` is set, never recommend beyond what fits. When `shelf_life_days` is set, never recommend more than can sell before spoilage. Surface a plain note when a cap binds ("capped at 200 — your storage limit"). If neither is set, ordering is unconstrained.
- **EOQ is advanced-only** — needs cost inputs users can't supply; never a required field or default-shown option.
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
  - **Owner-set acceptable wait/line (required to answer "how many workers"):** staffing has no correct answer until the owner says how much waiting is tolerable. **Ask the owner for their threshold — a max acceptable wait time OR max people in line** — then compute the smallest staff count whose expected wait/queue stays under it. Grounds the recommendation in the owner's own tolerance instead of an arbitrary utilization constant.

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
- **A missing day means "no data," never "zero customers."** Days not logged are ignored by the engine, not counted as zero. Combined with opening-days settings: closed days are expected-absent; open days with no entry are missing data, not zero.
- **Entry-timing rules (data integrity):**
  - Do NOT allow logging or editing *today's sales/customer totals* while the business is still open / the day hasn't finished (day's data is incomplete).
  - Do NOT allow live sales input outside opening hours.
  - Do NOT allow creating or editing a past day if that day is marked as a **non-working/closed day** — not even via the backfill screen. If the owner tries, show a friendly explanation.
  - **EXCEPTION — Recording a regular is always allowed**, including during open hours and any time of day. It is a point event, not a day-total, so timing rules don't apply to it.
  - Tap-only days (no manual total entered) roll into past-days automatically after closing hours.
  - **No duplicate past-day entry** — if a date already exists, refuse to create a second one and offer to edit the existing entry instead.
  - **After creating or editing a past day, stay on that date** — do NOT redirect back to yesterday. The owner is doing backfill work and expects to stay where they are.
- **Fluke (and any outlier flag) must be fully reversible.** If a day is marked as a fluke, the owner must be able to un-mark it and restore it to normal. The current bug (a fluke-marked day can't be recognised/un-marked even after editing) must be fixed. Fluke status is a user-editable label, not a permanent brand.
- **Data consistency rules (enforce the math; the daily total is the source of truth):**
  - **Known hours can't exceed the daily customer total.** When a past day has both hourly entries and a daily total, the sum of known hours must not be greater than the total. If it is, warn and let the user reconcile.
  - **Partial hours are allowed:** the user may enter only some hours plus a daily total. Treat the day total as truth; known hours are a partial breakdown; the remainder (total − known hours) is "unknown hours" — still counted in the day total, just not attributed to specific hours. Known hours always count as real hourly data.
  - **Offer "rely on the daily total only"** when hours and total mismatch: keep the known hours as data, mark the rest unknown, and trust the non-hourly total for the day.
  - **Products vs customers is NOT hard-bound** — a customer can buy multiple products, so product units may exceed customers (or be fewer). Do NOT block on this. Only flag *wildly* implausible mismatches (e.g. hundreds of products for a couple of customers) as "worth checking," never as an error.
  - General principle: the app should sanity-check that entered numbers correlate, warn on contradictions, but only hard-block truly impossible ones (like known hours exceeding the stated total).

## 10. Free vs premium gating

**Premium lifts limits / unlocks scale; the core decision tools stay free for everyone** (hourly, busiest-hour, staffing, change-detection, ordering, regulars/CLV, recurring patterns, full forecasting). Decided split:

**Premium:**
- **Multiple locations** — free = **one** business/location; premium = more. Include a **"copy settings & products to a new location"** action (copies configuration, **NOT the data/history**). **The UI must NOT offer a "transfer data/history" option at all** — each location's history is its own; only settings and products are ever copied. **Locations must be deletable** (with a confirm step). **Switching an account to premium must actually raise the location limit at runtime** — a premium user can immediately add more locations; the limit check reads the live tier, not a value cached at signup.
- **Extended history** — free history capped (~**1 year**); premium = more/unlimited.
- **More ads** — ads remain the premium-gated action: free gets a limited (but somewhat expanded) number of **ads**; premium = more/unlimited.
- (future) POS integrations.

**Free (generous / not gated):**
- **Events (one-off)** — the previous 2-event cap is removed. Give free users a **generous expanded allowance of one-off events** (e.g. 10+, not 2 — this must actually change in the code). **Recurring/consistent events (RecurringPattern) are always unlimited and free** — they're core owner-taught context.
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
- **EOQ**, D=10000, S=50, H=2 → `√(2·10000·50/2) ≈ 707`. (Advanced-only; never required.)
- **IQR outlier**, a weekday's history `[50,52,54,53,55,51,43]`: Q1≈51, Q3≈54, IQR≈3, lower fence ≈ 51−4.5 = 46.5, upper ≈ 54+4.5 = 58.5 → **43 is below 46.5 only slightly; with a realistic larger sample 43-vs-54 must NOT flag.** Test that ordinary variation (e.g. 43 when the weekday mean is 54 and spread is normal) is NOT flagged, and that a genuine extreme (e.g. 1500 vs ~54) IS flagged.

## 13. Open decisions to confirm

- Phase 1 has **no login** (single local user) to validate forecasting fast — confirm that's acceptable.
- ~~Auth provider for Phase 2~~ **DECIDED:** Supabase (managed auth + Postgres in one). Do not hand-roll password security.
- Web charting library (Recharts vs Chart.js) — minor; Recharts assumed.
- Exact free-tier limits and premium price point.
- **Wrong-forecast handling:** when actuals diverge from predictions, the self-correcting ensemble (section 2) should down-weight the models that missed and the tracking signal should flag sustained bias. Worth explicitly testing this behaves well once there's real data — simulate a demand shift and confirm the weights and intervals adapt sensibly.

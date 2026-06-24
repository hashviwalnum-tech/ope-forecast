# Operations Forecasting App — Project Specification

> This is the index spine. All decisions live in the linked topic files. Update this file as strategic decisions change; update topic files for implementation detail. Treat all files as the source of truth.

## Topic File Index

| File | Contains |
|------|----------|
| [FORECASTING.md](FORECASTING.md) | Engine, ensemble weights, trend/YoY, self-tuning, formulas, known-answer test cases |
| [DATA_MODEL.md](DATA_MODEL.md) | All entities, ordering lifecycle, batch/FIFO stock, data-integrity rules |
| [FEATURES.md](FEATURES.md) | Design language, UI features, regulars, ad/event, staffing, premium gating |
| [MOBILE.md](MOBILE.md) | Phase 4 mobile detail, Phase 4.5 beta readiness |
| [OPERATIONS.md](OPERATIONS.md) | Phase 2 deploy/auth, Phase 3.5 billing, Phase 5 integrations, engineering conventions |

---

## 1. Vision

**Ope is a neutral, trusted decision tool for variable-demand small businesses — one the owner teaches over time, and that gets stickier the more it's used.** The owner records what sells (end-of-day totals or, better, a tap per sale), and Ope turns that data — *plus the owner's own knowledge of their world* — into concrete decisions: how much of each product to order, how many staff to schedule, whether an ad/event paid off, and alerts when the pattern is drifting. Forecasting customers is the *engine*, not the headline.

**Strategic reframe (decided after stress-testing the idea):** raw "predict how many customers" has a value-decay problem — for an established business, demand settles into a band the owner soon knows by heart. The durable value is in the things that keep changing or that humans hold poorly in their heads: **per-product ordering, staffing, and detecting *change* (drift/anomalies)** — i.e. *decisions and change-detection*, not the prediction itself. Target customers are **variable-demand businesses** (cafés, restaurants, florists, grocers, bakeries), not stable-staple retailers (a hardware store with standing orders gains little).

**End-state:** a mobile app and/or an extension that plugs into smart registers (POS), which already emit time-stamped transactions. Designing around live per-transaction data now means the data model already matches what a register provides, so integration later is a natural fit, not a rewrite.

**Core design philosophy — human + machine (the owner knows the world):** Ope advises and computes; the owner knows context a model never will (rain Saturday, a festival, a regular on holiday). The app must always let the owner **override, teach, and correct** it — mark events, flag/ignore flukes, declare recurring patterns — and must never arrogantly replace local knowledge. Every feature should ask: *does this deepen neutrality, or the owner's investment in their own configuration?*

---

## 1.6 Strategic Positioning & Moat

The forecasting math is textbook and copyable; there is **no technological moat**. Defensibility comes from:
1. **Neutrality / POS-agnosticism** — incumbents (Square, Toast, Lightspeed, Clover) lock owners into their ecosystem. Ope works across registers, spreadsheets, and manual entry; an owner who switches POS keeps Ope. *This is a structural moat the incumbents cannot copy.* Prioritize integration breadth and never assume a single data source.
2. **Accumulated taught-context** — the longer an owner teaches Ope their world (recurring events, anomalies to ignore, their regulars, a customized home), the more painful leaving becomes. Personalized configuration = switching cost. Weak early, strong over time.
3. **Niche focus + trust** — own "the calm, trusted tool for small *variable-demand* businesses." Incumbents go broad and generic; Ope goes deep and beloved for a segment.
4. **Workflow embedding via the decision layer** — become where owners *make and track* ordering/staffing/promo decisions, not just view charts.

**MAKING THE MOAT FELT — earned retention, NOT artificial lock-in (decided).** Data export stays free (fighting portability breaks the trust that IS the differentiator; the moat is the intelligence built ON the data, not the raw data). Three concrete earned-retention features:
1. **"What Ope has learned about you" — insights view:** derived facts about the owner's own business they likely never saw laid out. Useful first, moat second.
2. **Accuracy-improvement-over-time story:** show the forecast getting better as they teach it — leaving = discarding that progress.
3. **Daily value + proactive nudges:** Ope proactively surfaces the ONE thing worth acting on today.

**Full earned-retention detail → [FEATURES.md](FEATURES.md#earned-retention-features-the-moat-made-felt)**

**Honest scope limits:** ordering value is weaker for staple/contracted goods and strongest for perishable/variable items — reinforcing the variable-demand target.

---

## 1.5 Product Identity & Design Language

- **Name:** **Ope**. **Slogan:** "Know Tomorrow, Today."
- **Audience:** small-business owners, including technophobes. Calm, comfortable, inviting UX.
- **Palette:** soft blue-green; header a brighter shade than body; soft tinted backgrounds, never pure white.
- **Plain language:** no jargon. Big tap targets. Dark mode supported system-wide.
- **Home:** quick actions at top → switchable forecast/order chart → busy hours. Fully user-customizable (drag to reorder, any chart can be pinned).
- **Design discipline (applies to EVERY change):** integrate new features into the existing navigation and design language. Do NOT add new top-level buttons or spread options that increase visible choice/clutter — nest sensibly behind existing entry points. Preserve the calm, focused, technophobe-friendly feel. When unsure how something fits the UI, propose a plan first rather than bolting on controls.

**Full design specification (palette corrections, home layout, ad slots, localization audit approach, all detail) → [FEATURES.md](FEATURES.md#product-identity-branding--design-language)**

---

## 2. Core Principle: Let the Data Choose the Weights

We do **not** hard-code which model matters most. The app runs several models in parallel, tracks each model's recent error per weekday, and blends their predictions weighted inversely to how wrong each has recently been. This is the self-correcting ensemble — the single most important design decision.

Active models: seasonal-naive, weighted moving average, exponential smoothing, blended by inverse holdout-MAE per weekday. Improvements to add: trend-aware component (so a rising business forecasts above the trailing average), year-over-year model (uses data the moment any exists, with a no-data guard), self-tuning meta-weights (shadow testing with strict guardrails).

**Full detail (trend, YoY, self-tuning guardrails, pipeline, integrity rules) → [FORECASTING.md](FORECASTING.md)**

---

## 3. Phased Roadmap

Build in phases. Prove the forecasting works before investing in accounts, billing, and integrations.

### Phase 0 — Scaffold
Repo structure, FastAPI backend skeleton, React web skeleton, `engine/` package with empty modules and a test harness, basic CI running the test suite.

### Phase 1 — MVP (the value proof)
No login, no billing, single user, local SQLite. Manual daily entry; CSV import; forecasting models (seasonal-naive, WMA, exp smoothing, Holt-Winters); ensemble that re-weights by recent per-weekday error; accuracy panel (MAD, MSE, MAPE, tracking signal); ordering (reorder point + safety stock); prediction intervals; event/ad marking + lift report; "not enough data" states everywhere.

### Phase 1.5 — Branding, calm UX redesign & live capture
Apply the Ope identity (§1.5) to the web app: logo, slogan, blue-green palette, plain-language labels, big friendly controls. Add fast "add product" flow and tap-to-record live sales (SaleEvent). Foundational, not premium, because it produces the hourly data later features depend on.

### Phase 2 — Accounts and cloud persistence
Supabase auth + Postgres; multi-user isolation (per-user data from day one); hosted backend + frontend with public URLs. Business-logic login fix (auto-load business, never re-prompt/lock-out) — DONE.

**Detail → [OPERATIONS.md](OPERATIONS.md#phase-2--accounts-and-cloud-persistence)**

### Phase 3 — Decisions, trust & polish
Build order is foundation-first, not feature-by-feature:

- **Tier 1 — Forecasting integrity (foundation):** missing/unlogged day ≠ zero; closed/non-working days excluded; outlier detection (IQR, flag-and-ask, never silent-delete); change-detection (drift/anomaly alerts). Approach: diagnostic-first (trace where it breaks, prove it with a test, then fix).
- **Tier 2 — Teaching / context features:** RecurringPattern; Regulars + CLV; anomaly/event marking working properly; home-page customization + copy current home into a "Predictions" tab.
- **Tier 3 — Decision depth + data-integrity guards:** per-product forecasting & order quantity; capacity + shelf-life constraints; whole-vs-decimal units; erase product; price field; entry-timing rules; Hebrew language.
- **Tier 4 — Look (polish last, on stable structure):** header a brighter shade than body; one switchable forecast/order chart; taller/wider tinted ad slots; finish the calm-but-alive palette.
- **Tier 5 — Strategic / longer-horizon:** multi-location (premium) + copy settings/products; advanced/planning toolbox; deeper POS-integration readiness.

Premium gating (limits) layers in around Tier 3–5; billing deferred to Phase 3.5.

### Phase 3.5 — Monetization
Stripe billing on web; ad placement in reserved slots; security hardening (premium tier via payment, Supabase RLS as defence-in-depth).

**Detail → [OPERATIONS.md](OPERATIONS.md#phase-35--monetization)**

### Phase 4 — Mobile
React Native (Expo), iOS + Android, full feature parity, same Render backend API unchanged. Build order: scaffold + auth + one screen (DONE) → Log screen → Forecast screen → Analytics screen → Manage screen.

**Full detail → [MOBILE.md](MOBILE.md)**

### Phase 4.5 — Beta Readiness
Onboarding (DONE); multi-business isolation tests; graceful weird-input handling; feedback form; Sentry error monitoring.

**Detail → [MOBILE.md](MOBILE.md#phase-45--beta-readiness)**

### Phase 5 — Integrations
POS connectors; Telegram bot (LLM agent with tools calling the real Ope API, proper account-linking via one-time code).

**Detail → [OPERATIONS.md](OPERATIONS.md#phase-5--integrations)**

---

## 4. Architecture

**API-first.** All business logic and math live behind a single JSON HTTP API. The web app is one client; the future mobile app is another. Nothing in the backend changes when mobile arrives. **No forecasting logic in any frontend.**

```
ops-forecast/
├── CLAUDE.md                 # short, always-loaded context (points here)
├── docs/
│   ├── PROJECT_SPEC.md       # this index spine
│   ├── FORECASTING.md        # engine, ensemble, formulas, test cases
│   ├── DATA_MODEL.md         # entities, ordering lifecycle, data rules
│   ├── FEATURES.md           # design language, UI features, premium gating
│   ├── MOBILE.md             # Phase 4 mobile detail + Phase 4.5 beta
│   └── OPERATIONS.md         # deploy, auth, Telegram, engineering conventions
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
│   ├── tests/engine/         # known-answer tests for every formula
│   └── requirements.txt
├── web/                      # React + Vite + TypeScript + Tailwind + Recharts
│   └── src/{api,components,pages,hooks}
├── shared/                   # later: TS types + API client reused by web + mobile
└── mobile/                   # Phase 4: React Native (Expo)
```

**Stack:**
- **Backend:** Python 3.11+, FastAPI, SQLAlchemy, Pydantic; numpy/pandas/scipy/statsmodels (use these — do not rebuild Holt-Winters or ARIMA by hand).
- **Database:** SQLite (dev/Phase 1) → PostgreSQL via Supabase (Phase 2+). SQLAlchemy makes the switch small.
- **Web:** React + Vite + TypeScript + Tailwind + Recharts.
- **Mobile (Phase 4):** React Native via Expo.
- **Auth (Phase 2):** Supabase Auth (managed; do NOT hand-roll password security).
- **Billing (Phase 3.5):** Stripe for web. Mobile needs App Store / Play in-app purchases (15–30% cut, own rules).

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

**MAKING THE MOAT FELT — earned retention, NOT artificial lock-in (decided).** The accumulated-context moat (#2) only works if the accumulated value is **visible and felt** by the owner. The retention strategy is *carrot, not cage*: leaving should mean losing genuinely valuable things they can't get elsewhere — never artificial friction. **Data export stays free** (fighting portability breaks the trust that IS the differentiator; the moat is the intelligence built ON the data, not the raw data). Three concrete earned-retention features (build insights → daily-value → nudges):
1. **"What Ope has learned about you" — a know-your-business insights view.** **CRITICAL LESSON (insights v1 was nearly worthless):** do NOT fill it with obvious facts the owner already knows ("Fridays are busiest" — they know). The value is in **non-obvious things that require computation across lots of data** — trends, changes over time, and warnings the owner would NOT spot themselves. Prioritize two kinds, and put them in the LAST/most-prominent row:
   - **Warnings / change-detection:** declining regulars (who's gone quiet), days that are slipping (a weekday trending down over recent months), a growing/shrinking peak hour, rising no-shows — things that are *changing* and worth catching early.
   - **Actionable predictions from history:** "last December you were ~20% busier than your current pace suggests — plan for it", "your Tuesdays have grown 15% over 3 months", "your 4pm rush now exceeds your morning peak."
   Keep **forecast accuracy** (the one genuinely-valued v1 item) and the accuracy-improvement story. Secondary/static facts (busiest day, peak hours, months logged) can stay but must NOT dominate — they're context, not the headline. Every insight: true, data-driven, no fabrication, honest when data is thin. The test for each insight: *would the owner already know this without the app?* If yes, demote or cut it.
2. **Accuracy-improvement-over-time story:** show the forecast getting better as they teach it ("started at ~18% error, now ~8%") — the accumulated value, charted; leaving = discarding that progress + facing the cold ~2-week ramp again. Honest framing, not manipulative.
3. **Daily value + proactive nudges (workflow embedding):** Ope proactively surfaces the ONE thing worth acting on today, delivered via the existing Telegram agent and/or in-app: "Tomorrow looks unusually busy (~55 vs usual 47) — consider extra help"; "Projected to run out of [product] by Thursday — reorder by tomorrow"; "Sunday looks unusually slow — you might cut staff." Each useful heads-up catches something the owner would miss and is a reason to keep Ope. Must be genuinely useful and not spammy (only ping when there's something worth acting on; respect a frequency limit; let the owner tune/mute).

**Future (engineered network value, needs many users):** anonymized benchmarking ("busier than 70% of similar businesses near you"; "cafés like yours typically see a December lift — here's yours") — value no single business can get alone, so it only exists by being on the platform. Real network moat, but later.

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
  - **Localization completeness — durable approach, not repeated patching (STILL INCOMPLETE after several attempts).** Hebrew strings keep reverting because each fix only catches some strings and CHART labels are handled separately from normal UI text. The piecemeal approach has failed repeatedly — switch to an **audit**: have the tool programmatically find EVERY user-facing string in the codebase (scan components for hardcoded text, chart label props, axis/legend/tooltip strings, series names, placeholders, button labels, empty states) and list which are NOT going through the translation system, then route all of them through it. Specifically: (1) one central translation source for ALL strings including **Recharts chart/graph labels, axis titles, legends, tooltips, and data-derived/series names** (these bypass the normal text path — the stubborn part); (2) make untranslated strings **detectable** (a check that flags any string not in the translation files) so gaps are visible instead of silently English; (3) explicitly cover recently-added features (Telegram panel, locations, regulars, all charts). It's light work but must be done by auditing the whole codebase centrally, not patching the strings someone happens to notice.

## 2. Core principle: let the data choose the weights

The single most important design decision. We do **not** hard-code that "same date last month" or "yesterday" matters most. For most of these businesses the strongest signal is **day-of-week** (this Saturday ≈ last Saturday), then events/holidays, then longer-term trend, with monthly pay-cycle effects a distant fourth. But it varies by business, so:

The app runs several simple forecasting models in parallel, tracks each model's recent error per weekday, and blends their predictions weighted **inversely to how wrong each has recently been**. A model that has been accurate lately gets more say; one that is drifting gets quietly down-weighted. This *is* the "self-correcting weights" feature, and it is far more robust than one large model trying to do everything.

**Currently active (per code audit):** seasonal-naive (unweighted mean of all same-weekdays), weighted-moving-average (last 4 same-weekdays, recency-weighted), and exponential smoothing (α=0.3), blended by inverse holdout-MAE per weekday. Outliers are median-substituted per weekday; missing days are absent (never zero).

**Improvement to make — TREND AWARENESS (the forecast currently lags a growing/shrinking business).** The active models are all recency-*level* estimators with no explicit trend term, so if demand is steadily rising or falling week over week, the forecast systematically lags (predicts low in growth, high in decline) because it averages past same-weekdays rather than projecting the direction. **Add a trend component** so a *consistent* recent rise/fall across same-weekdays is projected forward (e.g. a linear-trend or Holt's-linear model added to the ensemble, weighted by its own holdout accuracy like the others, so it only gets influence when it's actually predictive). This makes the engine more realistic and forward-looking without hand-tuning. Test that a steadily rising series forecasts *above* the last point, not at the trailing average.

**Explicitly NOT doing (would add noise):** weighting a single "same date last year" or one "month-ago day" as a direct predictor. One old data point is noise, not signal, and the app won't have a year of history for a long time. Long-range memory should come from **seasonality**, below — not single matched dates.

**YEAR-OVER-YEAR signal — use last year's data the MOMENT any exists, don't wait for a full year (corrected).** The old "seasonality only kicks in after ≥1 year" design was wrong — it left last year's data idle until an arbitrary threshold. Instead, add a **year-over-year model to the ensemble** that uses whatever long-range data is available, fed two signals: (1) the **same WEEKDAY ~52 weeks ago** (this Sunday compared to Sundays around the same time last year — same weekday, NOT the same calendar date, since one specific date is noise), and (2) **last year's trend/level for the surrounding week/month** (the general direction/level a year ago, e.g. "last year around now was rising / was ~X"). Combine these into a year-ago prediction.
- **Self-weighted by accuracy, with the no-data guard (critical — same protection that stopped the linear_trend 915 blow-up):** this model is weighted in the ensemble by its own holdout accuracy like every other model. With little or no year-ago data it must get **zero/minimal weight** (never a floor that lets it dominate on thin data) — so it can only gain influence once it has enough real year-ago points to be validated. It earns its say; it can't wreck the forecast prematurely. As year-ago data accumulates and proves predictive, its weight rises automatically.
- Degrades gracefully: with no year-ago data, contributes nothing and the forecast behaves exactly as today.
- **Owner-facing:** monthly comparison can also show same-month-last-year (this June vs last June) once that data exists — a useful year-over-year view.

**SELF-TUNING (champion/challenger shadow testing) — automated meta-weight optimization, with strict guardrails.** Beyond the per-model self-weighting, periodically search over different *meta-weightings* of the signal groups (e.g. how much to trust recent-week vs month vs year-ago, like "20% recent / 40% month / 40% year" vs other splits) to find which blend would have predicted past actuals most accurately. Run the best candidate ("challenger") **silently in shadow mode** alongside the current live blend ("champion"); if the challenger keeps winning under the guardrails below, it quietly becomes the new champion. Invisible to END USERS. **Guardrails are mandatory — without them this overfits and can make forecasts worse:**
- **Out-of-sample validation (the key anti-overfit defense, non-negotiable):** a challenger must prove itself on holdout data it did NOT tune on — never adopt a weighting just because it fit past data well. A weighting that best fits history is not necessarily best for the future.
- **High switch threshold + meaningful period:** the challenger must beat the champion **consistently over a meaningful window** (NOT a few days — overfitting shows up exactly in short windows) and by a **real margin** (not a trivial fraction) before adoption. High bar = stability; prevents erratic week-to-week strategy flipping.
- **Bounded weight options:** only sensible weight ranges are tried — never extreme blends (same anti-domination guard that stopped the linear_trend 915 blow-up).
- **Safety floor / instant rollback:** if an adopted challenger ever performs worse live, snap back to the champion immediately. Never let a bad tune persist.
- **Thin-data guard:** with insufficient history (e.g. the current ~26 days), the system must NOT switch at all — it needs enough data to tune AND validate out-of-sample. It stays on the safe default until there's enough data. (So it will mostly do nothing until beta provides months of data — expected.)
- **DEVELOPER-VISIBLE LOG (not shown to end users, but visible to the owner/developer):** every shadow comparison and every switch is logged ("switched meta-weighting on date X because challenger beat champion by Y% out-of-sample over Z period"). NOT a fully silent black box — a hidden mechanism that can degrade forecast quality must be inspectable, or a silent regression can't be diagnosed (lesson from silent-bug incidents: the roll-up that quietly stopped, dead reconciliation code). End users don't see it; the developer can.

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
- **Security hardening to do WITH billing (deferred from pre-beta as lower-risk-later):**
  - **Premium tier granting:** pre-beta, the self-serve free-upgrade hole is closed (no open `PATCH /tier`). When billing lands, a verified payment becomes the legitimate way premium is granted (replacing any manual/admin path).
  - **Supabase Row-Level Security (RLS):** deferred from pre-beta because app-layer isolation is already solid (audit-confirmed) and RLS is fiddly + fail-closed risky (wrong policies/missing user-context can block legitimate queries). Add it here as defence-in-depth, carefully and tested separately, since the data/stakes are higher once monetized. Requires passing per-user identity to the DB connection (or Supabase auth-aware connection) so policies can scope rows; test that legitimate backend access still works before/after.

### Phase 4 — Mobile
**Goal:** a React Native (Expo) app for **both iOS and Android** with **full feature parity** with the web app, reusing the **same Render backend API** (the forecasting/ordering/auth/database brain is unchanged — only a new front-end). Decided: Expo (handles build tooling, on-device testing via QR, and store submission), both platforms, full parity as the end state.

**Build order (foundation-first, verified before stacking — the approach that worked in Phase 3):**
1. **Scaffold + auth + one screen.** Expo project; Supabase auth working on a phone; one screen pulling real data from the Render backend. This proves the hardest part (auth + backend connectivity from a phone) before any features. Run on a real device via Expo Go. **DONE — app runs on phone, login + live forecast data working.**

**Mobile UX — its own design, NOT a shrunk web app.** A phone is tap-first and one-job-per-screen. Use a **bottom tab bar** (thumb-reachable, mobile-native) with **4 tabs**, large touch targets, generous spacing, one focused job per screen:
- **Log (default landing screen)** — the tap screen. Big, thumb-friendly buttons to record a sale/customer and tap each product. Opens first because logging is the most frequent action. Built for quick tapping while busy, not a shrunk form.
- **Forecast** — week prediction, busy hours (tomorrow + by weekday), what to order.
- **Analytics** — staffing/marginal-worker, ad/event lift, accuracy, deeper charts.
- **Manage** — products, regulars, past days/backfill, settings, Telegram connect, premium.
Each screen does ONE job with large tap targets; switch via the bottom bar. Full feature parity with web reached by building these out in waves.

2. **Navigation shell + Log screen** (the core daily action), tested on a real phone.
3. **Forecast screen** (week prediction, busy hours, ordering).
4. **Analytics screen** (staffing, ad/event lift, accuracy).
5. **Manage screen** (products, regulars, past days, settings, Telegram, premium) + remaining parity items: Hebrew + dark mode, home customization equivalent, etc.
Test each screen on the actual device before moving on — mobile feel (target size, spacing, flow) can only be judged in-hand.

**Reuse:** share TypeScript types and an API client between web and mobile where practical (a shared package or copied client) so the two front-ends stay consistent with the backend. The backend, database, and auth do NOT change.

**App-store path (the unpredictable tail — plan for it):**
- **Google Play developer account** (~$25 one-time) and **Apple developer account** (~$99/year).
- App icons, screenshots, store descriptions, a privacy policy, and content for review.
- **Apple review can reject and require resubmission** — budget time for back-and-forth. For digital subscriptions, Apple/Google usually require their in-app purchase (15–30% cut) — affects how premium billing works on mobile vs web.
- Expo EAS Build / Submit can streamline building and submitting to both stores.
- **Test on a real device throughout** (Expo Go / development builds) — don't wait until the end.

**Timeline (honest):** the app reusing the backend is a few weeks of iterative work; the store-submission tail is unpredictable (days to weeks). ~1–2 months to live in both stores, coding being the predictable part.

### Phase 4.5 — Beta readiness (hardening before real users)
Before real businesses use Ope, harden the things solo testing on clean synthetic data never exercised:
- **New-user onboarding** (DONE): guided setup — business name → opening hours → first products → how to log. Opening hours must be discoverable in setup (the engine depends on them). Honest expectation-setting that forecasts need ~weeks of data to be accurate.
- **Multi-business isolation:** several real businesses (café, florist, spa) on the system at once, with different patterns. Confirm NO data bleeds between accounts/businesses — forecasts, products, regulars, settings all strictly scoped per business/user. Confirm the premium/multi-location logic behaves with real separate users (free = 1 location, premium raises the limit at runtime; "copy settings + products NOT data" on new location; delete-location works).
- **Graceful handling of weird real input:** real people log 0, log huge numbers, skip days, put values in wrong fields, use the app at odd hours. The app must degrade gracefully — validate/clamp absurd inputs, never crash, show a helpful message rather than a 500. (Recall the disguised-CORS 500s — unhandled exceptions must not surface as cryptic failures.)
- **Feedback mechanism:** an in-app "Send feedback" form (web + mobile) — fields: **name, business, message** only. Submits and emails to hashvi2906@gmail.com on the backend (the user does NOT get redirected to a mail client — it's an in-app form like other websites). Simple, low-friction, translatable.
- **Error monitoring live:** confirm Sentry catches errors on web AND mobile so beta bugs surface to the developer rather than users silently giving up.

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
- **CSV import improvements:** (1) the template's instruction/example row (row 2) must be **skipped on import**, not parsed as data — currently it's misread as a date and errors. (2) When hourly columns are present, **auto-sum them into the daily total** (consistent with the hours-vs-total rule above). (3) Import is **slow and may not reliably complete** — make it performant and confirm it actually finishes (show clear success/failure, not a silent hang). Validate rows and report which rows (if any) couldn't be read, rather than failing the whole import. (4) **DATA-CORRUPTION BUG (priority, diagnostic-first):** import sometimes stores a *different number than entered* — e.g. 70 customers entered for a date imports as 89. "Sometimes, not always" suggests certain rows mis-parse, columns misalign, or the new hours-vs-total reconciliation is wrongly *adding* hourly values onto the daily total during import (89 ≈ 70 + some hours). Investigate why a known input changes value before fixing; add a test that imports a known file and asserts every stored value exactly matches the input. (5) **Template must include per-product daily totals** — columns for each product's quantity for the day (NOT broken down by hour), alongside the date, customer total, and optional hourly columns.
- **Manual entry / backfill screen** — a dedicated screen to add or correct a *specific past day*, separate from "Add Today." Use a **date picker (clickable calendar)**, never a free-text date field, so there is zero date-format ambiguity. The current workaround of changing the date inside "Add Today" is not acceptable as the only option — past-data entry must be a clear, comfortable, first-class feature. **By default this captures daily totals only** (most owners won't recall hourly breakdowns for past days), but offer an **optional way to add hourly detail** for a past day when the owner does have it — e.g. from smart-register logs. This is the same hourly shape POS integration will later import automatically, so building the capability now is forward-compatible. **The CSV import template must also support optional hourly columns**, so bulk history with hours (e.g. register exports) can be imported, not just daily totals.
- **CSV import** — for bulk history. Date handling must be robust: accept common formats, and **show the user how each date was interpreted before saving** (a preview), so DD/MM vs MM/DD confusion and Excel's auto-reformatting can't silently corrupt data. The on-screen example must actually match the stated expected format. Consider accepting ISO `yyyy-mm-dd` as canonical but tolerating others with the confirmation preview.

**Input mode B — live transactions (going forward, and what registers emit):** the owner taps a product button the instant a customer buys it ("just sold bananas" → tap). Each tap is stored as a time-stamped event. This is the richer source: because every sale carries a timestamp, the **hourly view, busiest-hour analysis, and staffing recommendations all derive automatically from this same data** — no separate hourly data entry needed. It also mirrors exactly what a smart register produces, lining up with the end-state.

**Aggregation:** the engine always reads **daily (and, when available, hourly) aggregates**. Those aggregates are either typed directly (mode A) or rolled up automatically from transactions (mode B). The forecasting engine doesn't care which mode produced them — keeping the two input paths cleanly separated from the math.

### Entities
- **Business** — id, name, settings (opening days/hours, default lead time, target service level, average service time per customer for staffing). One row in Phase 1; FK to user in Phase 2. **Opening days/hours must be editable in a settings screen** — and the forecasting engine must use them: closed days are excluded from forecasting entirely (not treated as zero-customer days), and hourly features only consider open hours.
- **Product** — id, business_id, name, **product_type ('stocked' | 'service', default 'stocked')**, **price (optional, in optional details)**, lead_time_days, **optional service_time_minutes (overrides the business default for staffing math — exposed in the product add/edit UI under optional details, defaulting to business setting when blank)**, **optional capacity (max units that physically fit — NOT "storage cost", that field must NOT exist)**, **optional shelf_life_days (spoilage)**, **unit_mode ('whole' | 'decimal', default 'whole')**. Capacity and shelf-life are **optional, off by default** — app must work cleanly when neither applies. When present they constrain ordering advice (see §6). **unit_mode controls counting AND forecast output: whole = always whole numbers ("order 45", never "45.3"); decimal = fractional input/output.** (This has regressed repeatedly — decimals reappearing for whole-unit products AND customers shown with decimals in the HOURLY CHART. Whole-unit display must apply EVERYWHERE: the forecast, order quantities, the demand chart, AND the busy-hours/hourly chart — customers are whole people, never "12.4". Add a guarding test covering the hourly chart too, so it stays fixed.) For decimal products, the tap-to-record screen must show an **editable tap-unit field** next to the button (e.g. "0.5 L / 0.1 L / 1 L") so the owner can adjust what one tap represents. Products must be **quick to add, edit, and DELETE** — erase-product is required and must actually work. **There is NO holding_cost and NO order_cost field — do not add or retain these. EOQ is advanced-only and must not require cost inputs from the user.**
  - **STOCKED vs SERVICE products (services don't get reordered — they get *performed*).** A product's `product_type` is chosen at creation. **Stocked good** → full stock/reorder/batch/FIFO system as today. **Service** (massage, haircut, facial) → forecast normally (demand is still predicted), but **NO stock or reorder concept on the service itself** — the app must never suggest "reorder massages" or show stock for a service. It is conceptually performed, not held.
  - **Service consumables (optional, reuses the stocked-good system).** When creating a SERVICE, the app asks whether it **uses any supplies** (e.g. oil for a massage, wax). If yes, the owner specifies which consumables and how much each performance uses; those **consumables are themselves regular STOCKED products** — tracked with the exact same stock count / capacity / shelf-life / reorder / batch system. Performing the service draws down its linked consumables' stock, and reorder advice/reminders apply to the **consumable**, not the service. **Optional + silent fallback (honesty rule):** if the owner adds no consumables for a service, the app says **NOTHING** about supplies for it — never invents a consumable, never nags. Consumables surface only if the owner provided them. **This is reordering/stock-side only — it does NOT affect the service's demand forecast.**
- **SaleEvent** *(mode B — live capture)* — id, business_id, product_id (nullable — a tap can record "a customer" with no specific product), timestamp, quantity (default 1; respects the product's unit_mode), optional unit_price. The raw transaction stream; foundation for hourly/staffing and POS integration.
- **DayRecord** *(mode A — daily totals, or the daily roll-up of SaleEvents)* — id, business_id, date (**unique per business — the app must REFUSE to create a second past-day entry for a date that already exists; offer to edit the existing one instead**), customers (int), notes.
- **SaleRecord** *(mode A)* — id, day_record_id, product_id, units_sold.
- **HourRecord** *(derived / analytics)* — id, business_id, date, hour (0–23), customers, units_sold. Rolled up from SaleEvents; powers busiest-hour and staffing.
- **Period** — id, business_id, start_date, end_date, type ('event' | 'ad'), label, optional cost, **recurring flag + recurrence rule (optional)**. One-off OR recurring (see RecurringPattern). Excluded from the "normal" baseline; recurring ones are folded back in as expected (see §6).
- **RecurringPattern** *(owner-taught context — a moat feature)* — id, business_id, label, weekday(s), **optional start-hour, optional end-hour** (if end-hour not set, the engine infers the extent from the data), effect (e.g. "higher"). For predictable repeating bumps the owner knows about — e.g. "a school trip every Sunday 9–11am." The engine must **treat these as expected (fold into the forecast for that weekday/hour), NOT flag them as anomalies.** Both start and end hour should be settable; if only start is set, pattern applies to that hour; if both are set, it spans the range.
  - **Outlier handling must ADJUST THE EXPECTED BASELINE, not blanket-exempt the weekday (fix — current code is a blunt weekday exemption).** The current implementation simply suppresses any flag on a recurring-pattern weekday, which means it stops watching that weekday entirely — a genuinely anomalous day (unexpectedly low, or far beyond even the expected bump) on that weekday silently escapes detection. WRONG. Instead, the recurring pattern should **shift/adjust the day's expected value (and therefore the fence) by the pattern's effect**, so: a day matching the expected bump sits near the adjusted center and is NOT flagged, BUT a day that deviates strongly from the *adjusted* expectation (e.g. far above even the expected bump, or unexpectedly low) STILL gets flagged. The safety net stays: the owner still hears about genuinely strange days on pattern weekdays — they just stop being pestered about the *expected* bump they already taught the app. The fence must be computed against the pattern-adjusted expectation, not bluntly skipped.
- **Regular** *(separate entity & data store — NOT in past-data/demand history)* — id, business_id, name, **first_visit_date**, avg_spend_per_visit, derived **CLV** (auto-computed), optional notes. Edited on a dedicated screen. **"Record a regular" logs ONE record per regular per day**, holding that day's running total spend. **It must be editable (additive) during open hours** — e.g. Sarah spends $20 at noon (logged), then $10 at 3pm → the owner edits today's entry to $30; this is the meaning of "record a visit twice." The day's total **locks after closing hours** (then it's final). Current bug: recording/editing a same-day regular visit is blocked — it must allow updating today's total. **Recording/editing a regular is allowed any time during open hours** (point-event, exempt from the sales entry-timing rule). Regulars never enter DayRecord/SaleEvent demand history.
  - **Regular profitability chart:** show how much a regular has earned the business over **this month, this year, and since first arrival** (using first_visit_date). This is CLV made visual. **OBSERVED BUG:** there is currently nowhere that actually shows a regular's profitability/tracking — the tracking exists in concept but isn't surfaced anywhere in the UI. It must actually appear.
  - **Regular churn / recent-months tracking:** also show a regular's visit frequency over **recent months** so the owner can spot a regular they may be **losing** (declining visits) — a retention signal. If a previously-frequent regular's visits drop off, surface it gently.
- **Ad/Event product targeting:** when creating an ad or event, **ask which product it's meant to promote/bring in** (with "customers" available as a selectable target, treated like a product). Then the lift analysis tracks the effect on *that specific target* (that product's sales, or overall customers), not just total customers — so the owner sees whether the ad moved the thing it was for.
- **ForecastRun** (recommended) — id, business_id, created_at, target_date, predicted value, interval low/high, model weights used. Lets accuracy be measured against what was actually predicted.
- **OrderRecord** *(ordering lifecycle — workflow-embedding feature)* — id, business_id, product_id, ordered_date, quantity, expected_arrival_date (auto = ordered_date + product.lead_time_days), status. The owner logs **"I ordered X units"** via a button; the app records it and **assumes arrival after the product's lead time** (no second confirmation — expected_arrival_date auto-set), at which point projected stock increases by the quantity. The order is **cancellable/editable until closing hours** that day (locks after close, same forgiving pattern as day-records/regulars). Also track **product creation date** (when the product was added) so its history has a start point.
  - **Projected stock tracking (build properly — currently exists but not well, in either app):** the app maintains projected stock over time. **Starting stock** is set at product creation (and can be set anytime for existing products). Stock **draws down** as sales are logged and **goes up** when a logged reorder arrives (after lead time). The owner can **manually override the current stock at any time** (a delivery was short, breakage, a miscount) — the app then **recalculates forward from the corrected number**, never stubbornly trusting its own projection over the owner's correction. Track stock **from product creation** so there's a real starting point.
  - **Honest fallback:** for an existing product with no starting-stock ever set, the app **cannot know current stock — it must SAY so** ("set a starting count to track this product's stock") rather than invent a number. Never fabricate stock figures. **Likewise the reorder forecast must prompt the owner to enter the amount/current stock** when it's missing, rather than showing nothing.
  - **Batch tracking + FIFO shelf-life (full version):** stock is tracked as **dated batches**, not one blob. Each reorder (and the initial starting stock) creates a **batch** = quantity + arrival date + its own **expiry** (arrival date + shelf_life_days). Sales **deplete the OLDEST batch first (FIFO)**. Spoilage is computed **per batch**: if a batch reaches its expiry with units left, those are flagged as spoiled/at-risk — not silently kept as good stock. **The app must clearly STATE that it ASSUMES you sell oldest stock first (FIFO)** wherever this affects advice, so the owner can correct it if they actually sell newest-first.
  - **Reorder-while-stock-remains prompt:** when the owner reorders while existing stock is still on hand, the app surfaces the existing **older stock and its expiry** ("you still have ~20 units expiring around [date] — those sell first"), so a fresh reorder doesn't hide the fact that the old stock is about to spoil. The new order becomes its own later-expiring batch.
  - **Two reminders:** (1) a **heads-up before** running low (approaching the reorder point), and (2) a **low-stock alert** at the reorder point. Both plain-language.
  - **"I reordered this" button** — prominent in the reorder section; the owner taps it when they place an order, capturing the quantity. Creates the OrderRecord and starts the arrival/stock projection (stock rises after lead time). **This button/action must be available in the reorder SCREEN itself, not only in the forecast chart.** **One reorder per product per day — you cannot reorder the same product twice in one day; instead you EDIT today's order while it's still open hours** (locks after closing), same forgiving pattern as day-records and regulars.
  - **Reorder window shows ONLY what needs reordering (scales to many products).** A real store may have 30+ products; the reorder/"what to order" view must list **only products at or below their reorder point** (the actionable list), not every product with mostly "you're good" noise. Keep it focused on what needs attention now.
  - **Separate "Product Status" view in Manage (full inventory overview + manual reorder).** A distinct screen under Manage lists **ALL products with their current stock/status**, where the owner can **proactively choose to reorder any product even if it doesn't need it yet** (e.g. ahead of a known busy period). This is the full-overview + manual-control counterpart to the focused reorder window.
  - **Favorite / pin a product or customer (appears first everywhere).** The owner can mark a product (or regular/customer) as a **favorite**; favorited items **sort to the TOP of every list, chart, and graph that includes them** (reorder, status, manage, forecast series pickers, regulars, etc.), with a visual marker (e.g. a star). Pinning reaches everything that features that product/customer.
  - **Arrival confirmation (the projection must actually advance over time — currently it doesn't):** stock projection is reportedly NOT advancing as days pass (an order placed on the 13th, due the 14th, showed no change by the 15th) — investigate and fix so projected stock actually updates with elapsed time and logged arrivals. PLUS add an **"Did this shipment arrive?" confirmation button** for each pending order, and a setting/option to **"always assume orders arrive on time"** (so the owner can either confirm each arrival manually, or let it auto-mark arrivals as on-time). When confirmed (or auto-assumed), the batch becomes available stock from that date.
  - **Settings toggle:** the owner can **turn reorder/stock management OFF entirely** for owners who don't want it.
  - **"You didn't order" warning — fires ONLY when projected stock is about to run out**, not on every recommendation. Dismissable ("leave it be") — when dismissed, don't nag again that cycle.

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
6. Produce a **prediction interval** that shows the **PROBABLE range, not the POSSIBLE range**. A range like 47–123 for a business that reliably does ~90 is technically a wide confidence band but practically useless — the owner knows it almost never hits those extremes. Show where demand *usually* lands (e.g. a ~50–68% band, roughly ±0.7σ, or an IQR-based band of typical days), so a ~90 business sees something like ~80–100, not 47–123. Base it on the **actual distribution of that weekday's real values / recent errors of the VALIDATED models only** — never just the min-to-max of history, and never inflated by unvalidated models. The goal: a range the owner can actually plan around. Keep it whole-number for whole-unit businesses.

**CRITICAL INTEGRITY RULES (these have repeatedly been mis-implemented — they must actually work end to end, verified by tests):**
- **A missing/unlogged day is NOT zero.** It must be excluded from averages, never counted as 0 customers/units. Symptom of the bug: the app forecasting 0 for a product on some weekday because absences were averaged in as zeros. A forecast must never be dragged down by days that simply weren't recorded.
- **Closed days / non-working days are excluded entirely**, not treated as zero.
- **Outlier detection uses IQR (interquartile range) — the standard, robust method — NOT a tight std-dev rule.** The current detector is far too sensitive (it flagged 43 customers against a ~54 average, which is completely normal variation). Replace it with: compute Q1 and Q3 of that weekday's history, IQR = Q3−Q1, and flag a day only if it falls below `Q1 − 1.5·IQR` or above `Q3 + 1.5·IQR` (the conventional Tukey fences; use 3·IQR for "extreme"). This must be evaluated **per weekday** against that weekday's own distribution, and must NOT fire on ordinary day-to-day fluctuation. A value within normal weekly variance is never an outlier. Needs enough history (several same-weekday points) before flagging at all.
- **Flag and ask — never silently delete.** A spike is often real (holiday, viral day, competitor closed). Prompt in plain language ("Sunday looks unusually high — one-off, or a real event?"); the owner chooses: mark event/ad, exclude as fluke, keep, or **mark as a recurring pattern** (RecurringPattern — then it's expected, not flagged again). Down-weight un-reviewed outliers; never fully discard silently. **Outlier detection still runs DURING event/ad periods** — a day can be unusually low/high even for an event period, and the owner must STILL get the choice to flag it as a fluke even while an event is running (don't suppress the fluke prompt just because a period is tagged). An unusually weak day during an event is both: still flaggable as a fluke by the owner, AND relevant to that event's lift analysis (the event may be underperforming).
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
  - **Marginal-worker value:** show what adding/removing one worker does ("a 3rd person at 5–6pm cuts the wait from 8 to 3 min") — queueing run at `c` and `c±1`, compared. Also show the **expected wait time / queue length** at current staffing. **Extreme-wait wording:** when the queue is overloaded the Erlang-C wait explodes toward infinity (e.g. "293 min") — this is mathematically real but useless to a user. When the projected wait exceeds a sane cap (e.g. ~60 min), don't show a silly precise number; say something like "you'd be severely understaffed" instead.
  - **Owner-set acceptable wait/line (NOT YET IMPLEMENTED — required to answer "how many workers").** Staffing has no correct answer until the owner says how much waiting is tolerable. The app must actually **ask the owner for their threshold — a max acceptable wait time OR max number of people in line** — and then compute the smallest staff count whose expected wait/queue stays under it. This question is currently not being asked anywhere; it must be added (in settings or the staffing view). **OBSERVED BUG:** staffing is producing strange advice (e.g. "add an 11th person" for ~10 people in an hour), partly because (a) it's running on garbage overnight hours that shouldn't exist, and (b) there's no owner threshold grounding it. Fixing the closed-hours leak and adding the threshold should both improve this; verify staffing numbers are sane on real opening-hours data.
  - **Ignore out-of-opening-hours entries.** Any customers/sales recorded in hours outside the business's opening hours must be ignored by the forecasting and staffing math (they shouldn't exist; don't let a stray out-of-hours number pollute the model), even if such an entry was somehow marked. **Logging customers on a CLOSED hour should not be counted at all** — neither toward the day total, the hours sum, nor the forecast. Ideally the UI shouldn't allow entering a closed hour; if a value is present there, it's discarded. **OBSERVED BUG:** the "Peak hours by day" view is showing overnight hours (1–5am) with high traffic for a business that isn't open then — confirming closed-hour data is leaking into the hourly/peak-hours forecast. Check whether opening hours are configured and whether this view actually applies the opening-hours filter; it must.
  - **Import sum tip (not in the file):** the CSV importer can't reliably read a template where the daily total is an Excel *formula/sum*. Instead of supporting formulas, show a short, plain-language, dummy-friendly tip **on the import page** explaining how to total hours in Excel (e.g. "to add up your hours, click an empty cell and type =SUM( then select the hour cells and press Enter"). Must be fully translatable.
  - **Import — adding earlier dates / expanding the range:** users should be able to backfill as far back as they have data. On the import page, show a clear, dummy-friendly explanation of **how to add earlier dates** — i.e. add more rows above/below with earlier dates in the date column to extend history further back (plain words, e.g. "to add older history, add a new row for each earlier day and put its date in the first column"). The template's date column should **default to / start at 1 Jan 2026** (the first example row dated 2026-01-01), so users have a clear starting point and can work backward or forward from there. All of this must be translatable.

### 7.5 Advanced / planning toolbox (isolated, plain-language, its own section)
Power-user tools, kept in a **separate "advanced/planning" area** and surfaced in **plain language, never as jargon** (a florist wants "should I order more given it might rain?", not "apply the Hurwicz criterion"). Most owners never open this; power users (and the home-customization feature) can pull pieces forward. Include:
- **Decision theory under uncertainty** — Hurwicz (optimism-pessimism) criterion, maximin/maximax, expected value; framed as "best/worst/likely case" choices.
- **Behavioral framing** — prospect theory (Kahneman–Tversky) awareness, e.g. loss-aversion-aware nudges around stockouts vs waste.
- **Linear programming (LP)** — simple optimization (e.g. allocate limited budget/space/staff across products to maximize expected profit subject to constraints).
- **Basic planning / project-management components** — lightweight scheduling/planning helpers.
These are clearly later-tier and must not bloat or intimidate the core experience. **Each tool must clearly EXPLAIN, in plain language, what it actually checks/does** (a short description per tool so a non-expert understands its purpose), and all of it must be **fully translated to Hebrew** (the planning-tools section currently doesn't translate). **Calmer ordering wording:** any "how does this ordering decision feel" / confidence prompt must be **worded gently and placed at the BOTTOM** of the ordering view, not upfront — the current phrasing/placement can feel alarming to owners. Reassure, don't interrogate.

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
  - **Duplicate past-day entry — offer in-place OVERRIDE, not just "go edit it."** If a date already exists, do not crash and do not merely tell the user to find it in Past Days. Show a prompt at the moment of conflict: "A record for this date already exists — Overwrite it with this data, or Cancel?" Overwrite updates the existing record directly with the new data; Cancel does nothing. (Current behavior wrongly says "find it in Past Days to edit it" with no overwrite option.)
  - **Undo an override (one-step):** when a day record is overwritten, keep the immediately-previous version so the owner can **restore it** ("undo — return to the previous version"). One step back is enough (not full version history). After restoring, the just-overwritten version can be re-applied if they undo the undo, but a single previous-version slot is sufficient.
  - **After creating or editing a past day, stay on that date** — do NOT redirect back to yesterday. The owner is doing backfill work and expects to stay where they are.
- **Fluke (and any outlier flag) must be fully reversible.** If a day is marked as a fluke, the owner must be able to un-mark it and restore it to normal. The current bug (a fluke-marked day can't be recognised/un-marked even after editing) must be fixed. Fluke status is a user-editable label, not a permanent brand.
- **Data consistency rules (enforce the math; the daily total is the source of truth):**
  - **Customer total ↔ sum of hours reconciliation (refined rule — the more detailed data wins).** When a day has hourly entries:
    - If the **hours sum is greater than** the manual customer total → the **hours sum becomes the customer total** (hourly detail is more reliable; the manual figure was too low).
    - If **no manual total was entered** → the **hours sum becomes the customer total** (derive the day total from the hours).
    - If the **hours sum is less than** the manual total → keep the manual total; treat the difference (total − hours sum) as **"unknown hours"** counted in the day total but not attributed to a specific hour. (This is the only case where the manual total "wins" — it means there were customers in hours the owner didn't break down.)
    - In all cases, typed hours always count as real hourly data, and the app should make the resulting day total clear to the user. (This has repeatedly not worked — implement it for real, with tests covering all three cases.)
  - **Partial hours are allowed:** the user may enter only some hours plus a daily total. Treat the day total as truth; known hours are a partial breakdown; the remainder (total − known hours) is "unknown hours" — still counted in the day total, just not attributed to specific hours. Known hours always count as real hourly data.
  - **Offer "rely on the daily total only"** when hours and total mismatch: keep the known hours as data, mark the rest unknown, and trust the non-hourly total for the day.
  - **Products vs customers is NOT hard-bound** — a customer can buy multiple products, so product units may exceed customers (or be fewer). Do NOT block on this. Only flag *wildly* implausible mismatches (e.g. hundreds of products for a couple of customers) as "worth checking," never as an error.
  - General principle: the app should sanity-check that entered numbers correlate, warn on contradictions, but only hard-block truly impossible ones (like known hours exceeding the stated total).
  - **Hourly-average suppression bug (zero-vs-absent error in the hourly path — FIX):** `hourly_averages()` divides each hour's total by the count of ALL distinct days, including days with no tap at that hour, so busy hours come back **suppressed below reality** (symptom: hours far lower than the real usual count). Same missing-day≠zero error already fixed for the daily forecast, surviving in the hourly math. Fix: divide each hour's total by the number of days that hour could actually have had activity (days within opening hours / actually tracked), not by all days. Add a test proving a consistently busy hour isn't dragged down by days where that hour had no data.

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

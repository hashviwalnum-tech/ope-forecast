# Operations, Deploy & Integrations

> Part of the ops-forecast documentation set. See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the index and roadmap.

## Phase 2 — Accounts and Cloud Persistence

**Goal:** make Ope reachable from a locked-down work computer through nothing but a web browser (no installs possible on that machine), with a login in place *before* it goes public so data is never exposed.

### Concrete Decisions

- **Auth + cloud database via Supabase** (one managed service for both). Use Supabase's built-in authentication — do NOT hand-roll password storage/hashing/reset; the managed service handles the security-critical parts. Email + password login to start.
- **Multi-user from the start.** Every row of business data belongs to an owner (account). Each logged-in user sees only their own business's data. Build this isolation now — retrofitting it later is painful. (Enforce with per-user filtering on every query, and Supabase Row-Level Security as defence in depth.)
- **Migrate SQLite → Supabase Postgres.** Move the existing schema and the user's current data into the cloud database.
- **Hosting:** deploy the backend and the web frontend to a host so they have public URLs. The work computer reaches the frontend URL in its browser; the frontend talks to the hosted backend. Free-tier 1-year data cap enforced server-side; data export available.

### Build Sub-Steps (do them one at a time, verifying each before the next)

- **2a — Supabase project + cloud database:** create the Supabase project, recreate the schema there, migrate existing data, point the backend at Postgres instead of SQLite. Verify the app still works locally against the cloud DB.
- **2b — Login & multi-user isolation:** add Supabase email/password auth; gate the app behind login; attach every business/record to a user; ensure each user sees only their own data; add Row-Level Security. Verify with two test accounts that data is isolated.
- **2c — Hosting/deploy:** deploy backend and frontend to public URLs; wire the frontend to the hosted backend; confirm Ope loads and login works from a normal browser (then test from the work computer).

**Honest risk note:** hosting and cloud auth are materially harder to debug than local work because the app no longer runs on a machine the owner controls. Corporate networks may also block unfamiliar sites — whether the work computer can reach the hosted app is a "try it and see." Keep local-run working as a fallback throughout.

**Live URLs:**
- Frontend: `https://ope-forecast-bngx.vercel.app`
- Backend health: `https://ope-forecast-dj78.onrender.com/health`

`/health` reports more than liveness: whether the test-only simulated clock is
off (`clock`), and which optional integrations this deployment can actually
perform (`configured`) — error reporting, feedback email, the Telegram bot, the
bot service key, the admin key, and how many CORS origins are allowed. Booleans
only, never the values. Recreating the Render service dropped `ALLOWED_ORIGINS`
and `SENTRY_DSN` without anything failing; this is how that becomes visible.

**What is and is not verified lives in one place: [VERIFICATION.md](VERIFICATION.md).**

---

## Phase 3.5 — Monetization

**Subscription billing** (Stripe on web) layered onto the premium-limit gating. **Ad placement** — slots already reserved in the design (see [FEATURES.md](FEATURES.md#ad-slots)). For mobile, App Store / Play in-app purchases are usually **required** for digital subscriptions (15–30% cut, own rules) — design the premium flow with that in mind.

**Load and concurrency testing** is deferred to here too. Every test to date has been one user at a time, and one pilot business will not find what several concurrent ones would. See [VERIFICATION.md](VERIFICATION.md).

### Security Hardening (deferred to coincide with billing, lower-risk-later)

- **Premium tier granting:** pre-beta, the self-serve free-upgrade hole is closed (no open `PATCH /tier`). When billing lands, a verified payment becomes the legitimate way premium is granted (replacing any manual/admin path).
- **Supabase Row-Level Security (RLS):** ~~deferred~~ **done, and confirmed against the live project.** `migrations/001_enable_rls_all_tables.sql` enables it on every table, and `python -m tests.deployment.probe_rls` asks the deployed project — using the published anon key, from outside — whether any table is reachable. All 19 refuse. Re-run it after adding a table; the probe's table list must be kept in step with `app/models/`.

---

## Phase 5 — Integrations

### POS Connectors

Smart register / POS connectors to auto-import sales.

### Telegram Bot

Lets owners log sales and ask for forecasts/orders in plain language. It's an **agent**: an LLM receives the message, chooses among tools (`log_sale`, `get_forecast`, `get_order_recommendation`), each tool calls the Ope API, and the LLM replies plainly.

**Architecture (production):**
- **Account linking:** each Telegram user has a unique `chat_id`. The owner generates a **one-time link code** in the web app and sends it to the bot once (`/link CODE`); the backend stores a **TelegramLink** (chat_id ↔ business_id), revocable from the web app. The bot never handles user passwords.
- **Service auth:** the bot is a trusted server-side caller holding a **bot service key** (shared secret). It calls dedicated backend endpoints that trust that key and scope every request to the linked business_id. Never reuse human login tokens in the bot.
- **Tools call the real Ope API** (Render backend) and return that business's real data — not stubs.
- **LLM provider swappable** behind a small abstraction (paid API / Gemini / local Ollama) so the model can change without touching tool logic.
- New table **TelegramLink** (id, business_id, chat_id, created_at); new endpoints: generate-link-code, redeem-link-code, and service-authed tool endpoints.

---

## Engineering Conventions

- The `engine/` package is **test-driven**: every formula gets a known-answer unit test before or alongside implementation. Textbook ops problems have exact answers — use them. See [FORECASTING.md](FORECASTING.md) for the full test-case catalog.
- Keep route handlers thin: validate input, call the engine, shape the response. No math in handlers.
- Keep forecasting logic out of the frontend entirely (so mobile inherits it for free).
- Strong typing both sides: Pydantic in Python, TypeScript in the clients.
- Store forecasts when made (ForecastRun) so accuracy is measured against what was *actually* predicted, not recomputed after the fact.
- **A change is NOT done until it is committed AND pushed to GitHub (`git push origin main`).** After every change meant for the live site, run the push yourself, confirm local and remote are in sync. Never end a task with unpushed commits.

---

## Open Decisions

- Phase 1 has **no login** (single local user) to validate forecasting fast — confirmed acceptable.
- ~~Auth provider for Phase 2~~ **DECIDED:** Supabase (managed auth + Postgres in one). Do not hand-roll password security.
- Web charting library (Recharts vs Chart.js) — minor; Recharts assumed.
- Exact free-tier limits and premium price point.
- **Wrong-forecast handling:** when actuals diverge from predictions, the self-correcting ensemble should down-weight the models that missed and the tracking signal should flag sustained bias. Worth explicitly testing this behaves well once there's real data — simulate a demand shift and confirm the weights and intervals adapt sensibly.


---

## A business's timezone, and what happens without one

Every "today", "now" and entry-timing check in the backend comes from
`business.settings["timezone"]` (`app/clock.py`). With no zone it falls back to
**UTC**, which quietly moves an owner's day: east of London the evening's takings
are filed under tomorrow, west of it the late night lands on yesterday, and the
busy-hours chart is shifted by the whole offset.

**Every creation path sets it.** Web (`BusinessSetup`) and mobile onboarding both
send the device's IANA zone at creation, and the backend refuses a zone it cannot
resolve rather than storing a typo. Copying a location inherits the source's zone;
if the source has none, the client's device zone fills the gap so the new business
is never born broken.

**Existing businesses are backfilled at startup** — `app/api/timezone_backfill.py`,
run from the lifespan beside the other migrations. It is idempotent, never
overwrites a zone the owner chose, and re-examines anything it could not resolve
on the next boot.

**It does not guess.** `engine/timezone_inference.py` answers only from:

1. **the currency**, where that is decisive — ILS is Asia/Jerusalem, JPY is
   Asia/Tokyo. EUR is deliberately absent: twenty countries, four zones;
2. **the business's own trading hours** — sale events are stored in UTC, so the
   zone that puts the most taps inside the stated opening hours is the likely
   one. This narrows a wide currency (USD spans six zones) and can answer alone.

Where neither decides, it returns **nothing**, and the business keeps no zone.
That is the deliberate outcome: a wrong zone is worse than an absent one, because
absent is visibly unset and can be asked about, while wrong silently misfiles a
day's takings. The refusal thresholds — enough events, a good enough fit, and a
clear enough margin over the runner-up — are in that module with their reasoning.

**What the owner sees when it cannot be determined:** the web app says so, in the
two places it matters. Settings shows that the zone is not set yet and that the
figure in the picker is only the device's guess; the busy-hours card says the
hours may be shifted and where to fix it. Both are driven by
`BusinessTime.isConfigured`, which distinguishes "the business has a zone" from
"we fell back to this device's".

# What has actually been verified, and what has not

One page, replacing the caveats that were scattered across the other docs. Every
row says what was checked, by what, and — where it matters — what would still go
wrong. Nothing here is aspirational: if something has not been exercised, it says
so plainly rather than being left to inference.

Last checked against the live deployment on **2026-09-08**.

Two words are used strictly:

* **Verified** — something ran and passed, and the thing that ran is named.
* **Unverified** — nobody has run it. Not "probably fine".

---

## The blocking question, per item

**Blocks a pilot** means one real business using Ope would hit it.
**Blocks a launch** means it is survivable with one attentive pilot but not with
strangers. **Neither** means it is a known gap that costs nothing yet.

| Gap | Status | Blocks |
|---|---|---|
| The live web app cannot reach its backend | **Broken now** | **A pilot** |
| Every optional Render variable is unset — Sentry, feedback email, Telegram, admin key | **Broken now** | **A pilot** |
| No email confirmation on signup | **Off by the project's current settings** | **A launch** |
| Password reset | Built; the link itself is untested until SMTP exists | **A launch**, until the email is proven |
| Real screen-reader behaviour | Unverified | A launch |
| ~6,500 machine-translated strings, no native review | Unverified | A launch |
| Real-device mobile behaviour | Partly verified | A launch |
| The guided tour in the other 13 languages | Unverified | A launch |
| Load and concurrency | Unverified | A launch |
| Billing and payments | Stub only | Neither (yet) |

---

## Broken right now

### The live web app cannot reach its backend — **blocks a pilot**

The bundle Vercel is serving calls `ope-forecast.onrender.com`, which no longer
exists. Vite bakes `VITE_API_BASE_URL` in at build time, so changing it in
Vercel's dashboard does nothing until the site is rebuilt.

The failure is worse than it sounds. The retired host neither answers nor
refuses — it accepts the connection and goes quiet — so nothing errors, nothing
retries, and a signed-in owner sits on "Loading…" for ever with no message.

Two guards were added, and neither fixes the deployment:

* both API clients now abandon a request after 30 s and treat that as the
  network failure it is, which reaches the existing "server unreachable" screen
  and its retry button;
* `web/vite.config.ts` refuses to build against a known-retired backend, so the
  next deploy carrying this mistake fails with a message naming the fix.

**To fix:** set `VITE_API_BASE_URL` to `https://ope-forecast-dj78.onrender.com`
in Vercel → Settings → Environment Variables (Production), then redeploy.

### Every optional Render environment variable is unset — **blocks a pilot**

Recreating the Render service dropped all of them. Only `DATABASE_URL` and
`SUPABASE_URL` survived, because the app will not boot without them. Nothing
failed loudly; each of these breaks quietly, and only when someone tries to use
it. `GET /health` now reports them:

```json
"configured": {
  "error_reporting": false, "feedback_email": false, "telegram_bot": false,
  "bot_service_key": false, "admin_key": false, "cors_origins": 2
}
```

| Variable | What is broken right now |
|---|---|
| `SENTRY_DSN` | Crashes go to the Render log and nowhere else. A beta user who hits one gives up quietly and nobody finds out. The integration in `app/main.py` is correct and starts working the moment the DSN is present — the code is fine, the deployment is not |
| `FEEDBACK_FROM_EMAIL` / `_PASSWORD` | The in-app feedback form answers 503. That is the one channel a beta user has for telling you something is wrong |
| `TELEGRAM_BOT_TOKEN` | The bot cannot reply at all |
| `BOT_SERVICE_KEY` | The bot cannot call the API |
| `ADMIN_KEY` | No manual tier grant, which is the only way to grant premium until billing exists |
| `ALLOWED_ORIGINS` | Nothing, for now. `cors_origins: 2` is the built-in default added after the allow-list was found empty and CORS was silently refusing the live frontend. Set it anyway — the default is a safety net, not configuration |

**To fix:** set them on Render, then re-check `/health` or run `probe_tenancy`,
which prints which are missing and what stops working.

---

## Verified against the live deployment

These were run against Render + Supabase Postgres, not a local SQLite file.

| What | How | Result |
|---|---|---|
| The published anon key cannot read any table | `python -m tests.deployment.probe_rls` | All 19 tables refused by row-level security |
| One tenant cannot reach another's data | `python -m tests.deployment.probe_tenancy` | Every isolation check held: no token → 401; a valid token naming another business's id returns the caller's own; reading, writing and deleting another tenant's business all refused |
| Postgres computes what SQLite computes | `python -m tests.deployment.probe_postgres_parity` | Identical answers on all 11 analytics endpoints for the same three weeks of trading |
| The simulated clock is off in production | `GET /health` → `clock: "live"` | Confirmed on the running process, not just in the source |
| The backend's clock is the real clock | `/health` `server_time` vs local | Within seconds |
| Deleting a location works on Postgres | `probe_postgres_parity` cleanup | Fixed — see below |
| Signup → login → onboarding → first data entry, through the real UI | Driven in a browser against the live backend and Supabase | Works. Run from a local dev server, because the deployed bundle cannot reach the backend — so Vercel's hosting is the one layer still unproven |
| A signed-in owner stays signed in after closing the app (web + mobile) | Both clients' own `@supabase/supabase-js`, driven against the live project, over a store that survives the process — see below | Reopening returns the session with nothing typed, and a token already a week past expiry is refreshed silently |
| The year-long simulation still scores identically | `run_year --to 365` then `score` | Byte-identical to the committed `docs/simulation/score.json` |

The parity probe found a real bug on its first run: the delete cascade emptied
its tables in mapper-registry order, which SQLite tolerates (it does not enforce
foreign keys unless asked) and Postgres refuses. An owner could not delete any
location that had ever held a product. Fixed, with two regression tests —
`backend/tests/test_business_delete_order.py`.

---

### Staying signed in between visits — verified 2026-09-11

Checked because it is the difference between an owner opening Ope and an owner
being asked for a password every morning.

Both clients keep the session in a store that outlives the process — the web app
in `localStorage`, the phone in `AsyncStorage` — so the question is only whether
a cold start recovers it. Driving each client's *own* installed
`@supabase/supabase-js` (web 2.106.2, mobile 2.108.1) against the live Supabase
project, over a file standing in for either store:

* sign in once, discard the client entirely, build a fresh one over the same
  store — the session comes back with nothing typed;
* rewind the stored access token to a week past its one-hour expiry and cold
  start again — the client spends the refresh token silently, and the new token
  is accepted by the server. This is the case that actually matters: anyone
  returning the next day arrives with an expired access token.

The live web app corroborates it from the other direction. A session on the
Vercel origin whose last password entry was **2026-09-03** was still signed in on
**2026-09-11**, across browser restarts, having refreshed itself on load; the
sign-in screen was never rendered. Refresh tokens rotate and each rotation was
accepted, so there is no session time-box or inactivity cut-off on the project.

**Email confirmation is a signup gate only.** Nothing in either client re-checks
it at sign-in, and the server does not either: `email_confirmed_at` is stamped
once and repeat password sign-ins were accepted against it. Turning
`mailer_autoconfirm` off (below) will not start asking existing owners to
re-confirm.

**Not covered:** the phone was not physically killed and reopened — the library,
the config and the refresh path are proven, the on-device step is not. Listed
under real-device mobile behaviour. A browser set to clear site data on exit
will still sign the owner out; that is the browser's choice, not Ope's.

---

## Unverified

### Real screen-reader behaviour — blocks a launch

**Verified:** 114 Playwright tests pass (`cd web && npm run test:a11y`) — axe-core
across every screen in light and dark, in English and Hebrew; keyboard traversal;
focus trapping in the tour and the Manage sheet; `role="alert"` on validation
errors; a screen-reader table with real numbers behind every chart.

**Unverified:** none of that is a screen reader. Nobody has driven Ope with
NVDA, JAWS, VoiceOver or TalkBack. Automated checks find missing labels and bad
contrast; they cannot tell you whether the experience is comprehensible — reading
order, whether a chart's table is reachable in practice, whether live regions
interrupt at the right moment.

### Machine-translated strings — blocks a launch

**Verified:** every key exists in all 15 languages, mechanically. `mobile`'s and
`web`'s i18n test suites fail on a missing key, a wholesale copy of English, a
lost `{placeholder}`, and an English pluraliser surviving into a language with no
such rule. RTL is applied to exactly he/ar/ur.

**Unverified:** whether the words are *right*. 466 mobile keys × 14 non-English
languages, plus the web set, and no native speaker has read any of them. The
booking strings added to mobile were lifted verbatim from the web i18n rather
than translated twice, so the two front-ends at least say the same thing.

Running the app in Russian for ten minutes found two screens that were never
translated at all: the whole sign-in page, and both "Back" buttons in the
onboarding wizard. Both are fixed, and `web/src/lib/noHardcodedText.test.ts`
now fails on literal text between JSX tags so that class of gap is caught by a
test rather than by someone happening to switch language. It does not cover
text passed as a prop (`placeholder`, `aria-label`), strings built in
JavaScript, or Recharts label props — those still need an eye.

`REVIEW_TRANSLATIONS.md` at the repo root lists the trust-critical subset —
ordering, stock and money terms where a wrong verb makes an owner order the
wrong quantity. That is the list to send to a native speaker first; nothing on
it has come back reviewed.

### Real-device mobile behaviour — blocks a launch

**Verified:** type-checks (`npm run typecheck`) and the i18n and backend-URL
tests pass. The app has run on a phone before — login and live forecast data
were confirmed on a device at the end of Phase 4 step 1.

**Unverified:** everything since, in-hand. Tap-target size, spacing, keyboard
behaviour, RTL layout, dark mode on a real screen, and the whole booking screen
added today have never been seen on a phone. The on-device checklist is being
run separately.

### The guided tour in the other 13 languages — blocks a launch

**Verified:** the tour's strings exist in all 15 languages and the i18n tests
prove none is missing. Focus trapping and Escape are covered by the a11y suite.
Its first step was seen rendering correctly in Russian during the live UI check.

**Unverified:** nobody has walked the tour end to end in anything but English.
A tour is where translation problems show worst — a step whose text overflows its
card, or an arrow pointing at a control whose translated label sits elsewhere, is
the first thing a new owner sees.

### Load and concurrency — blocks a launch

**Unverified**, entirely. Every test to date has been one user at a time. Render's
free tier sleeps after ~15 minutes and cold-starts in ~45 s; both clients retry
through that, but nobody has measured what happens with several businesses
logging sales at once, or what the Supabase connection pool does under it.

Deferred deliberately until closer to a public launch. One pilot business will
not find this.

### Billing and payments — blocks nothing yet

`app/billing/provider.py` holds a `StubPaymentProvider` that reports instant
success and a `verify_webhook` returning `{}`. The full premium system around it
— trial, gating, tier tracking, upgrade UI, subscription state — is built and
tested; only the processor is absent, behind an interface, as designed.

This blocks taking money and nothing else. Free-tier limits are enforced
server-side and read the live tier.

### Password reset — built, and half-verifiable until SMTP exists

It did not exist at all: no link, no call, and nothing that handled a recovery
link if someone arrived on one. It exists now on both clients.

**Verified** in a browser against the live Supabase project, in Russian so the
layout is exercised in a language that is not English: the request form, the
reply that deliberately says nothing about whether the address is registered,
the rejection of an address Supabase will not deliver to, and the set-password
screen.

**Unverified:** the link. Nothing can send one until a mail server is
configured, so the round trip — click, land, choose a password, sign in with it
— is the last step and cannot be done from here. [EMAIL.md](EMAIL.md) has it as
part of the test plan.

### Signup has no email confirmation — blocks a launch

The Supabase project reports `mailer_autoconfirm: true`. Signups are confirmed
instantly and **no confirmation email is ever sent**, so:

* anyone can register with an address they do not own;
* there is nothing to test in an "email confirmation flow", because there isn't
  one — this was checked directly against the live auth settings, not assumed;
* whether custom SMTP works is therefore also unverified, and password reset
  depends on it.

Signup and login themselves were verified end to end against the live project
(`probe_tenancy` creates real accounts through the real endpoint every run).

[EMAIL.md](EMAIL.md) has the setup: which provider, whether a domain is needed,
what to change in the Supabase dashboard and in what order, and how to prove a
real signup works for someone who is not the owner. `probe_tenancy` now checks
the confirmation gate — that a signup grants no session and an unconfirmed
address cannot sign in — the moment `mailer_autoconfirm` goes off.

## Re-running these checks

From `backend/`:

```
python -m tests.deployment.probe_rls               # anon key vs the database
python -m tests.deployment.probe_tenancy           # one tenant vs another, live
python -m tests.deployment.probe_postgres_parity   # Postgres vs SQLite, same data
python -m tests.deployment.report_timezones --sql  # what the backfill decided
python -m tests.deployment.find_business_orphans --sql
```

The two live probes create throwaway accounts and delete what they can. The API
will not delete an account's last location, by design, so each run leaves one
empty business behind; `find_business_orphans --purge-businesses <ids>` writes
the SQL to clear them.

From `web/`: `npm test`, `npm run test:a11y`, `npx tsc --noEmit`, `npm run build`.
From `mobile/`: `npm test`, `npm run typecheck`.

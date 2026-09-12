# What has actually been verified, and what has not

One page, replacing the caveats that were scattered across the other docs. Every
row says what was checked, by what, and — where it matters — what would still go
wrong. Nothing here is aspirational: if something has not been exercised, it says
so plainly rather than being left to inference.

Last checked against the live deployment on **2026-09-12**.

Two words are used strictly:

* **Verified** — something ran and passed, and the thing that ran is named.
* **Unverified** — nobody has run it. Not "probably fine".

---

## The blocking question, per item

**Blocks a pilot** means one real business using Ope would hit it.
**Blocks a launch** means it is survivable with one attentive pilot but not with
strangers. **Blocks Play** means Google will not accept the app until it is done.
**Neither** means it is a known gap that costs nothing yet.

| Gap | Status | Blocks |
|---|---|---|
| The backend can take 15+ minutes to wake, and sometimes refuses to | **Flaky** | **A pilot** |
| Vercel is serving a months-old build that calls the retired backend | **Broken now** | **A pilot** |
| Email confirmation is still off, and Supabase cannot send mail at all | **Broken now** | **A launch** |
| Three Render variables still unset — Telegram bot, bot service key, admin key | **Partly fixed** | A launch |
| No in-app account deletion | **Missing** | **Play** |
| No crash reporting on mobile | **Missing** | A launch |
| Password reset | Built; the link itself cannot be tested until mail works | **A launch** |
| Real-device mobile behaviour | Unverified | **Play**, and a launch |
| Real screen-reader behaviour | Unverified | A launch |
| ~6,500 machine-translated strings, no native review | Unverified | A launch |
| The guided tour in the other 13 languages | Unverified | A launch |
| Load and concurrency | Unverified | A launch |
| Billing and payments | Stub only; the platform rules are now researched | Neither (yet) |

---

## Broken right now

### The backend sleeps hard, and sometimes will not wake — **blocks a pilot**

Not the outright outage it first looked like, and the difference matters.

`https://ope-forecast-dj78.onrender.com` spent roughly fifteen minutes refusing
to answer at all. It resolved, accepted the TLS connection, accepted the request,
and returned **zero bytes** — across timeouts of 30s, 60s, 90s, 120s (three
times) and 240s, and on `/` as well as `/health`:

    * Established connection to ope-forecast-dj78.onrender.com (216.24.57.15:443)
    > GET /health HTTP/1.1
    * Request completely sent off
    * Operation timed out after 30011 milliseconds with 0 bytes received

Some time later, unprompted, it answered in **62 seconds** and has been healthy
since. Every live probe below was then re-run successfully against it.

So the service is not broken — it is on Render's free tier, which sleeps after
about fifteen minutes of inactivity, and its wake-up is far worse than the ~45
seconds that is usually quoted. Sometimes it does not complete at all.

**Why this still blocks a pilot.** An owner opening Ope first thing in the
morning is, by definition, hitting a sleeping backend. A minute of nothing is
already bad; the several attempts that returned nothing at all would look to them
exactly like the app being broken. The clients do retry through a cold start, but
they cannot retry through a wake that never finishes.

The fix is not code. It is either Render's paid tier, which does not sleep, or
something that pings `/health` every ten minutes to keep it awake. The second is
free and takes five minutes to set up with any uptime-monitor service, and is
worth doing before a real business is handed the app.

### Vercel is serving a build from before the fix — **blocks a pilot**

`VITE_API_BASE_URL` was set and the site redeployed, but the bundle Vercel is
actually serving **still calls the retired `ope-forecast.onrender.com`**.

Downloaded and inspected `https://ope-forecast-bngx.vercel.app/assets/index-Cq5jOFYB.js`:

    Na=`https://ope-forecast.onrender.com`

and `Na` is the base every request is built from (`fetch(`${Na}${path}`)`). The
string `dj78` does not appear anywhere in the bundle.

**The bundle is not built from current `main`.** None of the password-reset UI
strings are in it — no `Set a new password`, no `Forgot your password?`, no
`pwNewTitle` — even though that shipped in commit `3ac34da` and `main` is in sync
with GitHub. (An earlier grep for `resetPasswordForEmail` appeared to find it;
that hit was Supabase's own library, not Ope's code.) `Last-Modified` on the
asset is 10 September, after the last commit, so a deploy *did* run — it just did
not build this commit. The likeliest cause is that an older deployment was
re-promoted or redeployed rather than a fresh build being triggered from the
latest commit.

This also explains why the build guard did not catch it: `web/vite.config.ts`
refuses to build against a retired backend, and that guard was **confirmed
working** by running a build with the bad value —

    Error: VITE_API_BASE_URL points at ope-forecast.onrender.com, which no longer exists.

— but the guard is in a commit that this bundle predates.

**To fix:** trigger a fresh deploy of the current `main` in Vercel (not a redeploy
of an existing deployment), with `VITE_API_BASE_URL` set to
`https://ope-forecast-dj78.onrender.com` for the **Production** environment. Then
re-download the bundle and check that `dj78` appears in it.

### Supabase cannot send email, and signup is still unconfirmed — **blocks a launch**

Custom SMTP and email confirmation were reported as enabled. **Neither is in
effect on the live project.** Checked directly, twice, two ways:

* `GET /auth/v1/settings` on the live project returns **`"mailer_autoconfirm": true`**
  — signups are confirmed instantly and no confirmation email is ever sent.
* Signing up a throwaway address through the real endpoint returns a **full
  session** (`access_token` present) with `confirmed_at` stamped the same second.
  The gate is not merely unproven; it is demonstrably open.
* `POST /auth/v1/recover` for a real, existing account returns
  **`500 "Error sending recovery email"`**. Tried with two different domains, so
  it is not one blocked recipient — **nothing can leave the project**.
  Supabase error ids, if you want to look them up in the project's auth logs:
  `01a095c8-79cf-7e32-8833-b7b13f4e1860` and `01a095c8-e1d7-73cd-b1eb-1133c327b001`.

Check the Supabase dashboard again: **Authentication → Providers → Email →
"Confirm email"** must be on, and **Project Settings → Authentication → SMTP
Settings** must be enabled and saved with working credentials. A 500 on send is
the signature of Supabase's built-in mailer, which only delivers to members of
the project's own organisation — consistent with custom SMTP not having been
saved.

**Consequence for the request to "finish the loop" with a disposable inbox:**
it cannot be done, and it has not been faked. No email is sent, so there is no
link to click — not for signup confirmation and not for password reset. The
round trip stays untested. The moment mail works, `probe_tenancy` checks the
confirmation gate automatically, and the password-reset round trip is a
ten-minute job with a throwaway inbox.

### Render environment variables — three of six still unset

Re-read from the live `/health` on 2026-09-12 once the service woke:

```json
"configured": {
  "error_reporting": true, "feedback_email": true, "telegram_bot": false,
  "bot_service_key": false, "admin_key": false, "cors_origins": 2
}
```

| Variable | State | What that means |
|---|---|---|
| `SENTRY_DSN` | **Set** | Backend crashes now reach Sentry instead of dying in the Render log |
| `FEEDBACK_FROM_EMAIL` / `_PASSWORD` | **Set** | The in-app feedback form should work now. It has not been sent end to end — worth one real submission to confirm the mail actually arrives, since it uses SMTP directly rather than Supabase |
| `TELEGRAM_BOT_TOKEN` | **Unset** | The bot cannot reply |
| `BOT_SERVICE_KEY` | **Unset** | The bot cannot call the API |
| `ADMIN_KEY` | **Unset** | No manual tier grant — the only route to premium until billing exists. Set this before any pilot who is meant to see premium |
| `ALLOWED_ORIGINS` | Unset, defaulted | `cors_origins: 2` is the built-in default. Harmless for now; set it anyway, because the default is a safety net rather than configuration |

---

## Android — verified today, without a handset

The app had never been built for release. It has now.

| What | How | Result |
|---|---|---|
| A production release bundle builds | `expo prebuild --clean` then `gradlew :app:bundleRelease`, twice | **BUILD SUCCESSFUL** — a 48 MB `app-release.aab` with all four ABIs, `lintVital` passing |
| It targets the API level Play now demands | Read `uses-sdk` out of the built bundle's own merged manifest | `targetSdkVersion="36"` — Android 16. **The rule that took effect on 31 Aug 2026 is already met**, with no upgrade work needed |
| It asks for only the permissions it needs | Read `uses-permission` out of the same merged manifest | `INTERNET`, plus one app-private AndroidX permission. Four unneeded ones were being requested and are now blocked — see `PLAY_STORE.md` §2 |
| The EAS production profile emits an AAB, not an APK | `eas.json` | `"buildType": "app-bundle"` |
| The launcher icon survives Android's mask | Composited the adaptive foreground over its background and drew the mask and safe-zone circles on the result | Fixed. It did not before — see below |
| Type-checking, i18n and backend-URL tests | `npm run typecheck`, `npm test` | pass |

The icons were genuinely wrong, not merely unpolished. `applogo.png` has its
rounded corners painted in with **black** behind them, and it was being used as
the app icon, the splash and the adaptive-icon foreground. Android masks the
adaptive icon to the launcher's own shape, so that black would have shown as
notches on the home screen of every phone, and Play — which rounds the 512 icon
itself — would have shown it too. Replaced with a proper set: a full-bleed square
for Play, a white-gear-on-transparency foreground sized inside the 66/108 safe
circle, a gradient background, and a transparent-cornered version for the splash.

**What this does not tell you.** None of it has run on a phone. Everything about
the physical object — tap-target size, whether the keyboard covers the field
under it, legibility, the RTL flip in practice, dark mode on an OLED panel,
whether the session survives a real cold start — is still unknown.
`ON_DEVICE.md` has the steps to run it over USB and the checklist to work
through, and is explicit about which of those cannot be known until you do.

### In-app account deletion does not exist — **blocks Play**

Play requires any app that lets people create an account to offer deletion from
inside the app, plus a web link for the same. Searching the repository finds no
account-deletion UI on either client and no endpoint behind them. Business and
location deletion exist; account deletion does not.

The web-link half is now satisfied (`/privacy#delete`). The in-app half will fail
review. See `PLAY_STORE.md` §8 for the shape of the work — it needs a decision,
because it means a new destructive endpoint and the Supabase service-role key as
a new secret on Render.

### Mobile has no crash reporting

`@sentry/react-native` is not installed and there is no Sentry call anywhere in
`mobile/`. The web app has it; the phone does not. A beta tester whose app
crashes on a handset you have never seen will simply stop using Ope. Adding it is
a new dependency, so it needs a decision.

---

## The privacy policy was not actually being served

Found while gathering the URL Play requires. `vercel.json` has rewritten
`/privacy` → `/privacy-policy.html` for months, but the file sat at the
repository root, which Vercel never deploys. Both `/privacy` and
`/privacy-policy.html` were returning the app's `index.html` — with a **200**, so
nothing looked broken unless you read the page. The Settings link and the
download page's link both led there. The download page's link was worse: it
pointed at `/privacy.html`, a third address that has never existed anywhere.

Fixed by moving the file into `web/public/`, which Vite copies into the build
verbatim — confirmed present in `dist/` after `npm run build`. **Still to
confirm against the live site once Vercel is deploying current `main`.**

Its contents were also months out of date — it predated booking, currency, the
Telegram link and several other things. Rewritten against what the models and the
network calls actually do; the specifics are in `PLAY_STORE.md` §6, and the Data
safety answers derived from the same audit are in §7.

---

## Verified against the live deployment

These were run against Render + Supabase Postgres, not a local SQLite file. The
dates say when each was last actually run; the two isolation probes were re-run
today, once the backend woke.

| What | How | Result | Last run |
|---|---|---|---|
| The published anon key cannot read any table | `python -m tests.deployment.probe_rls` | All 21 tables refused by row-level security | **2026-09-12** |
| One tenant cannot reach another's data | `python -m tests.deployment.probe_tenancy` | Every isolation check held again: no token → 401 on all four endpoints; a valid token naming another business's id returns the caller's own; reading, writing and deleting another tenant's business all refused; a forecast ran against Postgres. The run's only failure is the three unset environment variables above | **2026-09-12** |
| Postgres computes what SQLite computes | `python -m tests.deployment.probe_postgres_parity` | Identical answers on all 11 analytics endpoints for the same three weeks of trading | 2026-09-08 |
| The simulated clock is off in production | `GET /health` → `clock: "live"` | Confirmed on the running process, not just in the source | 2026-09-08 |
| Signup → login → onboarding → first data entry, through the real UI | Driven in a browser against the live backend and Supabase | Works — but from a local dev server, because the deployed bundle cannot reach the backend | 2026-09-08 |
| A signed-in owner stays signed in after closing the app (web + mobile) | Both clients' own `@supabase/supabase-js`, driven against the live project over a store that survives the process | Reopening returns the session with nothing typed, and a token a week past expiry is refreshed silently | 2026-09-11 |
| The year-long simulation scores identically | `run_year --to 365` then `score` | Byte-identical to the committed `docs/simulation/score.json` | 2026-09-12 |

The parity probe found a real bug on its first run: the delete cascade emptied
its tables in mapper-registry order, which SQLite tolerates and Postgres refuses.
An owner could not delete any location that had ever held a product. Fixed, with
two regression tests — `backend/tests/test_business_delete_order.py`.

### Staying signed in between visits — verified 2026-09-11

Both clients keep the session in a store that outlives the process — the web app
in `localStorage`, the phone in `AsyncStorage` — so the question is only whether
a cold start recovers it. Driving each client's *own* installed
`@supabase/supabase-js` (web 2.106.2, mobile 2.108.1) against the live Supabase
project, over a file standing in for either store:

* sign in once, discard the client entirely, build a fresh one over the same
  store — the session comes back with nothing typed;
* rewind the stored access token to a week past its one-hour expiry and cold
  start again — the client spends the refresh token silently, and the new token
  is accepted. This is the case that actually matters: anyone returning the next
  day arrives with an expired access token.

A live session on the Vercel origin whose last password entry was 2026-09-03 was
still signed in on 2026-09-11, across browser restarts. Refresh tokens rotate and
every rotation was accepted, so there is no session time-box on the project.

**Email confirmation is a signup gate only.** Nothing in either client re-checks
it at sign-in, and the server does not either. Turning `mailer_autoconfirm` off
will not start asking existing owners to re-confirm.

**Not covered:** the phone was not physically killed and reopened. The library,
the config and the refresh path are proven; the on-device step is in
`ON_DEVICE.md` group A.

---

## The test suites

All green as of 2026-09-12.

| Suite | Command | Result |
|---|---|---|
| Backend | `cd backend && python -m pytest` | **890 passed** |
| Web unit | `cd web && npm test` | **91 passed** |
| Web types | `cd web && npx tsc --noEmit` | clean |
| Web build | `cd web && npm run build` | builds; `privacy-policy.html` confirmed in `dist/` |
| Accessibility | `cd web && npm run test:a11y` | **114 passed**, 4 skipped |
| Mobile | `cd mobile && npm test && npm run typecheck` | **11 passed**, types clean |
| Year-long simulation | `python -m tests.simulation.run_year --to 365` then `score` | unchanged — see below |

**The backend suite was not green when this run started.** Fifteen tests in
`tests/test_day_records.py` were failing with 403, and nothing in the code had
changed. The dates in that file were written out in full — `DATE_A = "2025-09-10"`,
under a comment reading "today is 2026-06-07" — and chosen to sit inside the
free-tier one-year history window. The window moved with the calendar and the
constants did not, so on roughly 11 September every test in the file began
failing because the date had aged out, not because anything broke. Six SaleEvent
timestamps were pinned to the same day and had the same problem. All of them are
now derived from `date.today()`, which removes the fault rather than pushing it
into next year.

**Forecasting was not touched.** No file under `backend/app/engine/` changed, and
the year-long simulation was re-run anyway: it still scores byte-identically to
the committed `docs/simulation/score.json`.

---

## Unverified

### Real screen-reader behaviour — blocks a launch

**Verified:** 114 Playwright tests pass — axe-core across every screen in light
and dark, in English and Hebrew; keyboard traversal; focus trapping in the tour
and the Manage sheet; `role="alert"` on validation errors; a screen-reader table
with real numbers behind every chart.

**Unverified:** none of that is a screen reader. Nobody has driven Ope with NVDA,
JAWS, VoiceOver or TalkBack. Automated checks find missing labels and bad
contrast; they cannot tell you whether the experience is comprehensible — reading
order, whether a chart's table is reachable in practice, whether live regions
interrupt at the right moment.

### Machine-translated strings — blocks a launch

**Verified:** every key exists in all 15 languages, mechanically. Both i18n
suites fail on a missing key, a wholesale copy of English, a lost `{placeholder}`,
and an English pluraliser surviving into a language with no such rule. RTL is
applied to exactly he/ar/ur. The `privacyPolicy` string added to mobile today was
lifted from the web i18n rather than translated a second time, so the two
front-ends say the same thing.

**Unverified:** whether the words are *right*. No native speaker has read any of
them. `web/src/lib/noHardcodedText.test.ts` fails on literal text between JSX
tags, but does not cover text passed as a prop (`placeholder`, `aria-label`),
strings built in JavaScript, or Recharts label props — those still need an eye.

`REVIEW_TRANSLATIONS.md` lists the trust-critical subset — ordering, stock and
money terms where a wrong verb makes an owner order the wrong quantity. Nothing
on it has come back reviewed. The Play listing copy should go on that list too:
it should be written in Hebrew by a person, not machine-translated.

### Real-device mobile behaviour — blocks Play, and a launch

See the Android section above and `ON_DEVICE.md`. The build is proven; the phone
is not.

### The guided tour in the other 13 languages — blocks a launch

**Verified:** the strings exist in all 15 languages and the i18n tests prove none
is missing. Focus trapping and Escape are covered by the a11y suite. Its first
step was seen rendering correctly in Russian.

**Unverified:** nobody has walked the tour end to end in anything but English. A
tour is where translation problems show worst — a step whose text overflows its
card, or an arrow pointing at a control whose translated label sits elsewhere, is
the first thing a new owner sees.

### Load and concurrency — blocks a launch

**Unverified**, entirely. Every test to date has been one user at a time. Nobody
has measured what happens with several businesses logging sales at once, or what
the Supabase connection pool does under it. Deferred deliberately; one pilot
business will not find this.

### Billing and payments — blocks nothing yet

`app/billing/provider.py` holds a `StubPaymentProvider` that reports instant
success and a `verify_webhook` returning `{}`. The premium system around it —
trial, gating, tier tracking, upgrade UI, subscription state — is built and
tested; only the processor is absent, behind an interface, as designed.

What is **no longer unknown** is which processor is even allowed.
`BILLING_PLATFORMS.md` has the research: Google Play Billing is required for
in-app purchase of premium, there is no B2B exemption, the 2026 relaxations cover
the US, UK and EEA but **not Israel**, and the route that costs nothing is to
sell on the web while the Android app stays silent about it. That constraint has
to be decided before the premium UI is built, because it determines whether an
Android owner may be shown an upgrade button at all.

### Password reset — built, and half-verifiable until mail works

It did not exist at all. It exists now on both clients.

**Verified** in a browser against the live Supabase project, in Russian so the
layout is exercised in a language that is not English: the request form, the
reply that deliberately says nothing about whether the address is registered, the
rejection of an address Supabase will not deliver to, and the set-password
screen.

**Unverified:** the link. Confirmed again today that Supabase cannot send it —
`/auth/v1/recover` answers 500. The round trip cannot be completed from here and
has not been. `EMAIL.md` has it as part of the test plan.

---

## Re-running these checks

From `backend/`:

```
python -m tests.deployment.probe_rls               # anon key vs the database
python -m tests.deployment.probe_tenancy           # one tenant vs another, live
python -m tests.deployment.probe_postgres_parity   # Postgres vs SQLite, same data
python -m tests.deployment.report_timezones --sql  # what the backfill decided
python -m tests.deployment.find_business_orphans --sql
```

All of these need the backend awake. If the first one hangs, that is the cold
start in the section above — wait a minute and run it again rather than assuming
the service is down.

The two live probes create throwaway accounts and delete what they can. The API
will not delete an account's last location, by design, so each run leaves one
empty business behind; `find_business_orphans --purge-businesses <ids>` writes
the SQL to clear them. Today's run left businesses **31 and 32**.

From `web/`: `npm test`, `npm run test:a11y`, `npx tsc --noEmit`, `npm run build`.
From `mobile/`: `npm test`, `npm run typecheck`.

To rebuild the Android release bundle, with **JDK 21** — Gradle 8.14 cannot build
under the JDK 25 that Android Studio now bundles:

```
cd mobile && npx expo prebuild --platform android --clean
cd android && JAVA_HOME=~/.jdks/jbr-21.0.11 ./gradlew :app:bundleRelease
```

To check what Vercel is actually serving, rather than what it was told to serve:

```
curl -s https://ope-forecast-bngx.vercel.app/ | grep -o 'src="[^"]*\.js"'
curl -s https://ope-forecast-bngx.vercel.app/assets/<that file> | grep -o 'https://[a-z0-9.-]*onrender\.com'
```

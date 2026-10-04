# Ope — final pre-launch audit

**Date:** 2026-10-04 · **Scope:** backend, web, Android app, live deployment, Play
compliance, market. **Working log:** `PROGRESS.md` in this folder. **Raw UX numbers:**
`ux/ux-sim.json`, `ux/ux-first-run-*.json`.

Words are used strictly: **VERIFIED** means something ran and passed and the thing
that ran is named; **UNVERIFIED** means nobody ran it; **JUDGED** is opinion.

---

## 1. Every change I made

Grouped by area. Each one is committed and pushed; tests were added with each fix.

### Security
- **Certificate checks were switched off** for the call that fetches the keys every
  login is verified against, and for the account-deletion call that carries the
  Supabase service-role key (which bypasses all row-level security). Anyone able to
  intercept that traffic could have forged a login for any account. Now verified,
  with a development-only escape hatch (`OPE_INSECURE_TLS=1`) that Render refuses.
  *VERIFIED live:* after deploy, real sign-ins still work and every tenant-isolation
  check holds (`probe_tenancy`, 2026-10-04 21:2x).
- **No secrets in the repository or its history** — pattern scan of every commit for
  cloud keys, bot tokens, private keys, passwords and service-role JWTs. The only
  thing ever committed was `mobile/.env` (Aug 2026), which held the public URL and
  the anon key that ships inside every app anyway. *VERIFIED (by pattern; a scanner
  can only find the shapes it knows).*

### Things the app promised that did not exist
- **Premium listed three perks that do not exist**: "No ads" (there are no ads),
  "Advanced analytics & self-tuning" (nothing is gated), "Priority support" (there is
  no support system). Removed from both apps. On Google Play, a subscription sold on
  those lines is a deception problem.
- **Empty "AD" boxes** were shown on the web to every owner, Premium included, with
  no ad network behind them. Switched off.
- **Premium history**: the code gives unlimited history; one line said 1.5 years,
  another "unlimited". Both now say unlimited.
- **Data export did not exist**, though the privacy policy promised it. Built:
  `/export/days.csv` (same columns the import reads, so it goes straight back in) and
  `/export/all.json` (every table, derived from the schema so a future table is not
  forgotten). Web: Settings → Your data. Phone: Settings → Your data shares the
  spreadsheet through Android's share sheet. Free on every plan.
- **Telegram** was offered in both apps, handing out link codes — but the bot program
  is not in this repository and its token is unset in production, so nothing could
  ever redeem a code. The apps now hide it (web) or say plainly it is not switched on
  yet (phone) until a bot exists.
- **Privacy policy** now describes the in-app deletion route that exists, the export
  that exists, the Google Play purchase record the backend keeps, and the sign-in
  email attached to feedback. The Play listing draft no longer promises "no adverts"
  and softens "it gets better" to "usually gets more accurate".

### Language — what a Hebrew-speaking owner actually saw
- **Sentences written by the server reached every owner in English**: the
  unusual-day question ("Was this a special event?"), the daily heads-up, every
  free-plan limit, "you're still open until 5 pm", future dates, closed days. The
  backend now sends a code plus the numbers beside its English; both apps build the
  sentence in the owner's language. Done in the API layer, so all ~35 places that
  show an error are covered at once. A validation error no longer appears as raw
  JSON, nor a dropped connection as "Failed to fetch". *VERIFIED live:* production
  returns `{"code":"future_date","params":{...}}`.
- **The phone app had ~90 hard-coded English strings** on Products, Past days,
  Orders, Regulars, Telegram, the Settings time-zone section, every screen title,
  month and weekday names, and validation messages. All now in 15 languages.
- **12 characters on four phone screens were garbled** (UTF-8 mis-read as Hebrew
  Windows-1255 and saved that way — "…" showed as gibberish), plus 283 more in
  comments. Repaired.
- **The home and product charts named days in English in 13 languages** ("Mon 10/05"
  in German). Now from the date, in the owner's language.
- **Regulars showed `$` in 14 languages and `₪` in Hebrew**, whatever the business's
  currency, and forced two decimals (wrong for yen). Fixed; the currency guard now
  also scans both translation files.
- Trends showed "N total · N days logged" in English. Fixed.
- **New guards so this stops recurring:** a phone version of the hard-coded-text test
  (it did not exist); a stronger web version that also sees text on its own line and
  text next to a `{value}`; a garbled-encoding check; tests that every server code
  has a sentence in all 15 languages with no placeholder left unfilled.

### Honesty of wording
- "Your forecasts are typically accurate to within 12%" read the *average* error as
  a bound — about half of days miss by more. Now "On average, your forecasts are off
  by about 12%."
- Two strings sent owners to "Manage → Settings", where Settings no longer lives; one
  told web owners to upgrade there, where nothing can be bought.

### Comfort and accessibility (measured — see §3)
- Phone home and Predictions **scrolled sideways by 97 px** (a hidden screen-reader
  table sized itself to its content). Fixed: 0 px.
- Desktop **Past days made the page 2,800 px wide** (a hidden label escaped its
  scroll box). Fixed, and the same trap closed in two other scroll boxes.
- **Loading lines pulsed down to 3.9:1 contrast** — the text owners watch during a
  cold start. Pulse softened; now above 5:1 throughout.
- **Unlabelled amount boxes** for regulars (screen readers said only "edit text");
  Home's version was also 34 px tall. Labelled, 44 px.
- Radio and checkbox rows in Settings and CSV import were ~22 px tap targets. 44 px.
- **Phone: "Log today" link on the Log tab.** Typing end-of-day totals — one of the
  two ways the spec says owners log — lived only under Manage → Past days, five taps
  away. Now three.
- Phone product form accepted a delivery time of 0 days, which the server rejects.
- **First run:** the wizard's "Save & continue" was disabled with no explanation
  until days were picked; a one-line hint now says so. The trial-ending banner now
  waits for the trial's final week instead of greeting owners on day one.

### Reliability and operations
- **Backend kept awake in business hours** — a free scheduled ping every 10 minutes,
  04:00/05:00 to midnight/01:00 Israel time; asleep overnight to stay inside Render's
  750 free hours. (Measured cold start today: **75 seconds**.)
- **There was no CI.** Every suite now runs on every push — backend on Python 3.11.16,
  the version Render actually uses (local runs here use 3.12).
- **The phone's tests only passed on one machine**: two read `mobile/.env`, which is
  not committed. Found by the first CI run; fixed without weakening the check.
- **Feedback could never be answered**: Reply-To was Ope's own address and the
  sender's email wasn't included. Now it is.
- **The live isolation probe now cleans up after itself** by deleting its throwaway
  accounts through the real deletion endpoint — which also exercises Play's
  required deletion path against production on every run.
- **UX measurement is now a committed suite** (`web/playwright.ux.config.ts`); the
  previous review's script was never saved, so its numbers could not be re-run.
- The nudge engine had no tests (the engine is supposed to be test-driven): 8 added.
- Build notes (`CLAUDE.md`): `prebuild --clean` deletes the Android SDK pointer, and
  a locally built bundle is debug-signed — the upload must come from EAS.
- `VERIFICATION.md`'s summary table brought up to today.
- Removed a dead phone screen (`DashboardScreen.tsx`, imported nowhere, all English).

---

## 2. Still broken or risky — most severe first

1. **The live website is serving an old build.** `ope-forecast-bngx.vercel.app`
   still serves `index-Cq5jOFYB.js`, which calls the retired backend — the web app
   cannot work for anyone. Vercel *is* building every commit successfully (GitHub's
   deployment records show it, up to today's), but the production domains are not
   being moved to new builds. That is what Vercel does after an **Instant Rollback**:
   automatic promotion stays off until someone promotes a deployment. **Fix (you, 2
   minutes):** Vercel → project `ope-forecast` → Deployments → newest → ⋯ →
   **Promote to Production**. Then check that the page's script no longer contains
   `ope-forecast.onrender.com`. *VERIFIED broken; the cause is my inference.*
2. **`/privacy` returns the app, not the policy** — same cause. Play requires a
   working privacy-policy URL and a web route for deletion requests. Fixed by #1.
3. **Email confirmation is still off** (`mailer_autoconfirm: true`, checked today).
   Anyone can register an address they don't own; password-reset mail cannot be sent.
   Supabase dashboard: Authentication → Email → Confirm email, and SMTP settings.
4. **Render deploys are slow**: today's backend change took ~90 minutes from push to
   live (the earlier one ~25). Not a failure — but don't push a fix during a pilot
   and assume it is live. Check `/openapi.json` or the Render dashboard.
5. **No offline handling on the phone.** A tap made without signal retries for a
   few minutes and then fails; the sale is lost unless re-tapped. For a busy owner on
   café Wi-Fi this is the biggest everyday risk. Needs a queued-taps design (§4).
6. **Phone date fields are free text** ("2026-01-15") in Past days, Ads & Events and
   Bookings; the spec requires a calendar. Needs a native date-picker dependency.
7. **The phone cannot create service products or link supplies** (the web can).
8. **Design issue, not a coding one:** the free plan's 1-year history cap also trims
   what the *forecast learns from*, not only what the owner sees. The spec's iron rule
   is "never gate anything that affects forecast accuracy"; once a business has more
   than a year of data, the year-over-year signal for free owners is cut at the edge.
   Recommend capping what is shown and edited, never the engine's input. Not changed:
   it alters forecasts and is a product decision.
9. Leftover test debris in production: empty businesses **31, 32, 37, 38** and their
   sign-ins, from probe runs before the probe could clean up.
   `python -m tests.deployment.find_business_orphans --purge-businesses 31,32,37,38`.
10. Telegram, Google Play verification and Play notifications are unconfigured on
    Render (`/health`). Expected for now; they block paid Premium, not a pilot.

---

## 3. Measurements

### UX — year-long business, after fixes (`ux/ux-sim.json`)
144 screen states: 12 screens × {English, Hebrew} × {light, dark} + Arabic + German,
at 390×844 and 1280×800. Local dev server, so load times are relative.

| | Phone | Desktop |
|---|---|---|
| WCAG AA contrast failures | **0** (was 3 in German) | **0** (was 5 in German) |
| Other WCAG failures (axe) | **0** (was 10 unlabelled fields) | **0** |
| Text under 12 px | 0 | 0 |
| Sideways scroll | 0 px except Settings: 5 px (en), 29 px (de) | 0 px (was 1,493) |
| Targets under 44 px | 5 across 12 screens | ~100 — the 36-px header nav; 0 under 24 px (desktop's legal minimum) |
| Sticky header | 62 px (7% of screen) | 74–114 px |
| Median screen switch | ~0.6 s | ~0.6 s |
| Tallest phone screens | Ads & Events 11.5 screens, Home 7.8, Predictions 7.5 | |

The one remaining phone overflow (Settings, a few px) is cosmetic and not fixed.

### Cold start — live
75 s to answer `/health` this afternoon (curl). Mitigated by the keep-awake ping
from now on; *UNVERIFIED* that GitHub runs it on schedule — check the Actions tab
tomorrow morning.

### Taps for the five most common jobs (JUDGED from the code; not timed on a phone)
| Job | Phone app | Web on a phone |
|---|---|---|
| Record a sale | **1** (+1 per product) — Log is the landing tab | 2 |
| Log end-of-day totals | **3** (was 5) | 2 + typing |
| See tomorrow | 1 (Forecast tab) | 0 (Home) |
| Log a delivery order | 3–4 (Forecast → I reordered this → qty → save) | 3–4 |
| Record a regular's visit | 3–4 | 2–3 |

Fine where it matters most (a sale is one tap). Nothing else needs fewer.

### Accuracy — year-long simulation
Ope 10.20% MAPE against a noise floor of 7.68%, beating both naive baselines.
Re-run after every change: see §7.

---

## 4. The market, and what Ope is missing

Looked at: **MarketMan, MarginEdge, Restaurant365, Toast (xtraCHEF), Square,
7shifts, Crunchtime, Lineup.ai, ClearCOGS, Apicbase, Fresha, Vagaro**, and the Israeli
POS vendors **Tabit** and **BeeComm**.

**Where Ope is ahead.** Neutral across registers; plain language with a simple mode;
15 languages with real RTL; flags unusual days and *asks* instead of deleting them;
measures whether an ad or event actually worked; honest about how little data it
has; booking-aware demand for appointment businesses; priced for one café rather than
a chain (the incumbents start around $150–$300/month or come bundled with a POS).

| Gap | Who has it | Recommendation |
|---|---|---|
| **POS integration** (sales arrive automatically) | Everyone above; Tabit/BeeComm in Israel | **(b) soon** — the strategy depends on it; manual logging is Ope's biggest adoption cost. Tabit already partners with MarketMan, so an integration path exists |
| **Offline logging** | Toast, Square (POS-native) | **(a) before a pilot** for the phone — queue taps locally and send when back online |
| **Holiday calendar** (esp. Israel's moving holidays) | Crunchtime, Lineup.ai (holidays/events) | **(b) soon** — Rosh Hashana and Passover move every year; the year-ago model compares same weekday 52 weeks back and will misalign them. Owners can tag them by hand today |
| **Weather in the forecast** | Crunchtime, Lineup.ai, 7shifts | (b) — real value for florists and cafés; free APIs exist |
| **Staff accounts / roles** | 7shifts, Toast, Vagaro | (b) — an owner can't let a barista tap sales without sharing the password |
| **Push notifications** | All mobile-first products | (b) — the daily heads-up exists but only reaches Telegram, which isn't running |
| **Supplier ordering** (send the order to the supplier) | MarketMan, MarginEdge, R365 | (c) out of scope for now — Ope advises; doesn't need to place orders |
| **Recipes / ingredient-level costing** | MarketMan, MarginEdge, Apicbase | (c) — a different, accounting-shaped product |
| **Invoice scanning, food-cost accounting** | MarginEdge, R365 | (d) skip — the opposite of "calm, focused" |
| **Shift scheduling with names** | 7shifts | (c) — Ope says *how many*, which is the decision |
| **Appointment reminders, deposits, no-show fees** | Fresha, Vagaro | (c) — they own that; Ope only needs their booking counts |
| **Demo / sample data** for a new owner | Common in trials | (b) — see first run, §5 |

### Boring essentials

| Essential | State |
|---|---|
| Data export | **Built today** (was missing) |
| Account deletion, in app + web | Built; *VERIFIED live end to end* today (data and sign-in gone) — web route broken until #1 |
| Undo | One-step undo on taps and on overwritten days |
| Search | None. Lists are short for one small business; fine for now |
| Contact us | In-app feedback form; replies now possible |
| Help | The guided tour; no help pages or FAQ |
| Backup / restore | Supabase's own backups; no owner-facing restore. Export is the owner's copy |
| Free-plan limits hit | Clear message, now in the owner's language; *VERIFIED* by tests that each limit binds |
| Multi-device | Same account on web and phone; *VERIFIED* session persistence earlier (09-11) |
| Offline / poor connection | Retries through a cold start; **no offline queue** (§2 #5) |
| Sample data | None (§5) |

---

## 5. First run — what a new owner sees

Walked by `web/tests/ux/first-run.spec.ts` against an empty database with a real
Supabase account, at phone size, in English and in Hebrew (`ux/ux-first-run-*.json`).
*VERIFIED* in the browser; *UNVERIFIED* on the phone app.

| Step | Taps | What the owner sees | Checks |
|---|---|---|---|
| Welcome | 1 + typing | "What's your business called?" — one field | 0 contrast / WCAG failures |
| Wizard 1 of 3 | 6–8 | Open days (none pre-selected), hours, currency | **The button stayed greyed out with no reason until days were picked — fixed today with a one-line hint** |
| Wizard 2 of 3 | 1 | Add products now, or later | clean |
| Wizard 3 of 3 | 1 | "Tap Record a Sale each time…", forecasts need a couple of weeks | clean |
| Guided tour | **35** taps of Next to the end (Skip all / Skip section exist) | Opens over a home screen that is still loading | clean |
| Home, day one | — | "Your first task: add the products you sell… then, after you close tonight, log the day" | clean |

**When does a new owner first get something useful?** From the code's thresholds:
a rough "still learning" range after **2** logged days; ordering advice per product
after **7**; busy hours after **7** days of taps; the real forecast after **14**.
So the first useful number arrives on day 2–3, and the first number worth acting
on around week two. **JUDGED:** that two-week gap is where owners will be lost —
it is the honest answer, but the app gives them little to do in it. The CSV import
closes it for owners with history; nothing does for owners without. A
"what Ope will show you" sample on the empty screens, or sample data to explore,
would carry people through it.

**JUDGED:** 35 tour steps is too long for a nervous first-day owner. Shorten the
default tour to the five things they need this week; keep the full tour behind
Settings.

**Changed today:** the trial banner ("Your free trial ends in 29 days — upgrade")
was the first thing on day one, before a single forecast, and its button cannot sell
anything on the web. It now appears only in the trial's final week.


### Personas (JUDGED, from the measurements and the code)
- **First-day, low-tech owner.** Setup is short and kind; the 35-step tour and the
  two-week wait for a real forecast are where they'll drift away (above).
- **Busy owner mid-rush, one hand.** One tap per sale on the phone, big targets, an
  undo. The risk is the connection: no offline queue (§2 #5).
- **Hebrew, right-to-left.** Today was mostly about this owner. Before today they hit
  English in the daily heads-up, the unusual-day question, every limit message, the
  "still open" rule, and across six phone screens. Measured clean in Hebrew and
  Arabic now; *UNVERIFIED* by a native reader.
- **Owner with a year of data.** The simulated year runs clean in every measured
  state; pages are long on a phone (Ads & Events is 11.5 screens tall, Home 7.8).
- **Skeptical owner who wants to know why.** Accuracy is shown, and now phrased
  honestly as an average miss. Model names stay behind the details layer.
- **Glare, tired eyes.** No text under 12 px anywhere; 0 contrast failures in both
  themes; the faded loading text that dipped to 3.9:1 is fixed.

### When things go wrong (item 19)
- **Backend asleep.** Both apps retry for up to ~4 minutes with a "waking up"
  message; failures now say, in the owner's language, to check the connection, and
  that nothing was lost. The keep-awake ping should make this rare in the day.
- **No network.** Same message. Taps are not queued (§2 #5).
- **A failed save.** Rule refusals now explain themselves in the owner's language;
  a malformed entry says "check the numbers" instead of raw JSON.
- **Empty and partial data.** Every screen has an empty state; "still learning"
  ranges from day 2. Outside English the generic translated note is shown instead
  of the server's more specific English one — a deliberate trade.
- **Interrupted task.** *UNVERIFIED* — forms keep their state while the page stays
  open; nothing persists a half-typed form across closing the app.
---

## 6. Google Play

| Requirement | State |
|---|---|
| No steering to outside payment, any language | **VERIFIED clean** in both apps' strings (searched for web, browser, APK, discount, prices, processors). The billing commit of 10-01 already removed the phone's "pay on the website" note |
| Prices from Play, not hard-coded | No price is shown anywhere. The purchase screen itself is **not built** ("coming soon") — Premium cannot be bought yet |
| Subscription terms + manage/cancel link | Manage link to Play's own subscriptions page exists. Terms disclosure belongs on the purchase screen, which doesn't exist yet |
| "Remove ads" promise without ads | **Fixed today** |
| Account deletion in app | Built; verified live |
| Account deletion via the web | Policy page describes it — **unreachable until Vercel is promoted** |
| Privacy policy URL loads | **No, today** — serves the app (§2 #1, #2) |
| Data safety answers match the code | Updated today: purchase history (Play token) declared; feedback content + email declared; deletion route corrected. See `PLAY_STORE.md` §7 |
| SDKs | Supabase, Sentry (no PII), Expo modules. No ads, no analytics SDK |
| Permissions | **VERIFIED today** from the rebuilt bundle's merged manifest: INTERNET, ACCESS_NETWORK_STATE, and one app-private receiver permission. No dangerous permission |
| Target API 36, signed AAB | **VERIFIED today**: `bundleRelease` succeeds (50.7 MB), `targetSdkVersion 36`, `minSdkVersion 24`. **But a local build is signed with Android's debug key, which Play refuses.** The upload must be built by EAS (`eas build --platform android --profile production`), which holds the upload key in your Expo account — *UNVERIFIED* that those credentials exist |
| Store listing claims | Accuracy claim is hedged ("usually gets more accurate"; "worth trusting after two to four weeks"), defensible against the simulation |
| Families / audience | Not for children; policy says so |
| Name and icon | No conflicting "Ope" app found in a quick search. **UNVERIFIED as a trademark** — needs a search in Israel (ILPO), EUIPO and USPTO before spending on the brand |

---

## 7. Final suite results

| Suite | Result |
|---|---|
| Backend `pytest` | **987 passed** (969 at start) |
| Web unit `npm test` | **99 passed** (91 at start); `tsc` clean; build OK; lint 41 (pre-existing baseline) |
| Accessibility (Playwright + axe) | **117 of 118 passed, 4 skipped**; the one failure (`axe — light / he › predictions_home`, desktop) **passed on immediate re-run** — a flake, not fixed, worth watching |
| Mobile `npm test` / typecheck | **16 passed** (11 at start) / clean |
| CI (GitHub Actions, Python 3.11.16) | green on every commit after the `.env` fix |
| Android `bundleRelease` | succeeds; API 36; debug-signed (see §6) |
| Year-long simulation | **byte-identical** to the committed `score.json` after all changes (Ope 10.20% MAPE) |

---

## 8. What blocks what

**Blocks a Play submission**
1. Vercel promotion (privacy URL + web deletion route).
1. An EAS production build (properly signed); the local bundle is debug-signed.
2. A real phone run of the release build (`ON_DEVICE.md`), at least once.
3. Store listing in Hebrew written by a person; screenshots.
4. Data safety form filled from `PLAY_STORE.md` §7 (updated today).

**Blocks a first pilot business**
1. Vercel promotion — the web app is unusable today.
2. Confirm tomorrow morning that the keep-awake ping ran (GitHub → Actions).
3. Offline tap queue on the phone — or tell the pilot to log end-of-day totals.
4. Email confirmation + SMTP, so password reset works for a real owner.
5. A Hebrew speaker reading the trust-critical strings (`REVIEW_TRANSLATIONS.md`) —
   every string added today is machine-written too.

**Blocks nothing yet**
Paid Premium (needs the phone purchase screen + Play setup), Telegram, POS
integration, weather, holidays, staff accounts, load testing.

---

## 9. Unverified, plainly

- **Nothing has run on a real phone.** Not the app, not today's changes, not the new
  share-your-data or Log-today buttons. Type checks and tests pass; that is all.
- **No screen reader** has been used (axe checks are automated rules, not NVDA/TalkBack).
- **No native speaker** has read any of the ≈2,400 translation lines added or rewritten today, in
  any language. They are machine-quality like the rest.
- **Real payment** — never run against Google.
- **The keep-awake schedule** — committed; not yet observed firing.
- **Real users** — none.
- **Your Google, Vercel, Supabase and Render accounts** — I cannot see their
  dashboards; every statement about them comes from what they serve publicly.
- **Trademark** status of the name.

---

## 10. Verdict

**Not yet ready to put in front of a real shop owner — but close, and the reasons
are mostly not code.**

The forecasting core is sound and honest, the data is isolated, deletion works in
production, and today's pass removed a security hole and a long list of things that
would have embarrassed it with a Hebrew-speaking owner. What stops a pilot today:

1. **The website doesn't work** (stale Vercel deployment) — a 2-minute fix for you.
2. **Email is off**, so no password reset for a real owner.
3. **Nothing has been tried on a real phone**, and the phone loses taps without signal.

**Designed wrong rather than coded wrong:**
- The free history cap trims what the forecast learns from — against your own rule.
- The two-week wait before a useful forecast has nothing to carry the owner through it.
- The phone uses typed dates where the spec demands a calendar.
- Premium today sells mostly *limits* (locations, history beyond a year, ads count);
  with the false perks removed, it's thin for a paid subscription — as the spec itself
  warned.

Fix the three blockers above and run one week with one friendly café on the phone,
logging end-of-day totals, before anything else.

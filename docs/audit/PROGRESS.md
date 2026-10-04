# Final pre-launch audit — running log

Started 2026-10-04. This file is the working log; the finished report is
`FINAL_AUDIT.md`. Labels: **VERIFIED** (ran, named what ran), **UNVERIFIED**
(nobody ran it), **JUDGED** (opinion).

## Baseline (before any change), 2026-10-04

| Suite | Result |
|---|---|
| Backend `pytest` | 969 passed |
| Web `npm test` | 91 passed |
| Web `tsc --noEmit` | clean |
| Web lint | 41 problems (pre-existing baseline ~40) |
| Web build | OK; `privacy-policy.html` in `dist/` |
| Mobile `npm test` / typecheck | 11 passed / clean |

## Live deployment, 2026-10-04

- **Backend cold start: 74.8 s** to answer `/health` (curl, `time`). Clock `live`.
  `/health.configured`: `admin_key` and `account_deletion` now **set** (were unset on
  09-12); `telegram_bot`, `bot_service_key`, `google_play_verification`,
  `google_play_notifications` still **unset**; `cors_origins: 2` (default).
- **Web app still broken — VERIFIED.** Both `ope-forecast-bngx.vercel.app` and
  `ope-forecast.vercel.app` serve `assets/index-Cq5jOFYB.js`, which calls the retired
  `https://ope-forecast.onrender.com`. Same file name as on 09-12. Meanwhile GitHub's
  deployment records show Vercel project `walnum/ope-forecast` building every commit up
  to `3717e77` successfully (latest `ope-forecast-k2wp4x5iu-walnum.vercel.app`, behind
  Vercel Authentication). So builds succeed but the production domains are not moved to
  them. That pattern matches Vercel's behaviour after an Instant Rollback (auto-assign of
  production domains is switched off until a deployment is promoted). **Needs the
  owner's Vercel dashboard** — cannot be fixed from the repo.
- **`/privacy` serves the app shell, not the policy — VERIFIED**, same cause (stale
  deployment). Play requires a working privacy-policy URL.
- **Email confirmation still off — VERIFIED.** `GET /auth/v1/settings` →
  `mailer_autoconfirm: true`.
- **RLS — VERIFIED.** `probe_rls`: all 19 tables refused to the anon key; the probe's
  table list matches all 19 `__tablename__`s in `app/models`. PostgREST's schema listing
  is also refused to the anon key.

## Changes so far (commit by commit)

### Batch 1 — `d00f4bb`
- Server-written sentences (rule errors, nudges, unusual-day prompt, "not enough
  data" notes) now reach the owner in their language on both apps; errors carry a
  `code` + `params` beside the English `detail`.
- Regulars screen named `$`/`₪` regardless of currency; fixed in 15 languages
  (web) + 11 (mobile); guard test now scans both translation files.
- Premium history: code says unlimited; one string said 1.5 years. Fixed.
- Nudge engine had no tests; 8 added.

### Batch 2
- **Security:** TLS verification was OFF for the Supabase JWKS fetch (forged
  signing key ⇒ forged logins) and for the account-deletion call that carries the
  service-role key. Now verified; dev-only escape hatch `OPE_INSECURE_TLS=1`,
  refused on Render. Tests in `test_tls.py`.
- **Premium promised three things that don't exist:** "No ads" (there are no ads),
  "Advanced analytics & self-tuning" (not gated), "Priority support" (no support
  system). Removed from both apps. Web's empty "AD" placeholder boxes (shown to
  Premium too) switched off.
- **Data export never existed** although the privacy policy promised it. Built:
  `/export/days.csv` (import-compatible) and `/export/all.json` (every table,
  derived from the delete cascade's table list). Web: Settings → Your data.
  Phone: Settings → Your data shares the CSV via the Android share sheet.
- Feedback emails had Reply-To set to Ope's own address and no sender contact —
  feedback could never be answered. Now carries the sign-in email.
- Privacy policy: deletion section now describes the in-app route; discloses Play
  purchase data; feedback email. Play listing no longer promises "no adverts".
- **Phone app had ~90 hard-coded English strings** (Products, Past days, Orders,
  Regulars, Telegram, Settings timezone, titles, month/weekday names, validation
  messages) and **12 garbled characters** (UTF-8 mis-decoded as Windows-1255).
  All routed through t() in 15 languages; new guard tests on both apps catch
  multi-line text, text next to `{value}`, English props, and garbled bytes.
- Phone product form accepted lead time 0, which the server rejects; now asks for 1+.
- Ads & Events on the phone showed a hard-coded `$`.
- Removed dead `mobile/src/screens/DashboardScreen.tsx` (imported nowhere).

## Findings not fixed (reported)
- Phone uses free-text YYYY-MM-DD date fields in Past days / Ads & Events /
  Bookings; spec requires a calendar picker. Needs a new native dependency.
- Phone cannot create service products or link supplies (web can).
- Free 1-year history cap trims the forecast's *training* data, not just what the
  owner sees — at odds with the "never gate accuracy" iron rule (design issue).

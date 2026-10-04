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

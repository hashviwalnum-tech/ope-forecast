# CLAUDE.md — Operations Forecasting App

Short, always-loaded context. Full design lives in `docs/`.

Always-loaded spine (auto-included below):
@docs/PROJECT_SPEC.md

**Before working in any area, read the relevant topic file** (NOT auto-loaded — read on demand):
- `docs/FORECASTING.md` — engine, ensemble weights, self-tuning, formulas, known-answer test cases
- `docs/DATA_MODEL.md` — entities, ordering lifecycle, batch/FIFO shelf-life, data-integrity rules
- `docs/FEATURES.md` — design language, UI features, staffing/queueing, premium gating
- `docs/MOBILE.md` — Phase 4 mobile detail, Phase 4.5 beta readiness
- `docs/OPERATIONS.md` — deploy, auth, Telegram, billing, engineering conventions

## How to work with me (important)
I am not a programmer and cannot debug or fill in gaps — do the whole job and verify it yourself.
- Be token-efficient: keep replies short, don't paste full file contents unless I ask, and run commands/tests yourself — report only pass/fail plus any errors.
- Explain decisions in one or two plain-language sentences, no jargon.
- Work one milestone at a time. After each, stop and tell me in plain steps how to check it runs.
- Before anything large or not in the plan (new dependency, deleting code, changing architecture), ask me first in one sentence.
- If commands change, update the Commands section below.

## What this is
A forecasting tool for customer-facing businesses. Owners log daily customers and per-product sales; the app predicts demand by day of week (hour/month for premium), recommends how much to order, measures ad/event lift, and re-weights its own models against actual results so accuracy improves over time.

## Architecture (do not deviate without updating the spec)
API-first. All logic and math live in a Python/FastAPI backend behind a JSON API. The React web app is one client; a React Native app (Phase 4) will be another. **No forecasting logic in any frontend** — it belongs in `backend/app/engine/` so mobile inherits it for free.

## Stack
- Backend: Python 3.11+, FastAPI, SQLAlchemy, Pydantic, numpy/pandas/scipy/statsmodels.
- DB: SQLite (dev/Phase 1) → Postgres (Phase 2+).
- Web: React + Vite + TypeScript + Tailwind + Recharts.
- Mobile (Phase 4): React Native (Expo), reusing the backend + a shared TS package.

## Build order
Phase 1 = MVP, **no login / no billing / single local user**. Prove the forecasting first. See the roadmap in the spec, section 3. Don't build auth, billing, hourly, queueing, or ARIMA until their phase.

## Hard rules
- `backend/app/engine/` is **pure functions** (no DB, no framework) and is **test-driven**: every formula gets a known-answer unit test (see spec section 12) — write the test alongside the function.
- Route handlers are thin: validate → call engine → return. No math in handlers.
- Use `statsmodels`/`scipy` for Holt-Winters, ARIMA, and regression — do not hand-roll them.
- Do not hard-code forecast weights. The ensemble learns them from recent per-weekday error (spec section 2).
- Exclude event/ad periods from the "normal" baseline when training.
- Strong typing both sides (Pydantic + TypeScript).
- **Design discipline (applies to EVERY change):** integrate new features into the existing navigation and design language (spec §1.5). Do NOT add new top-level buttons or spread options that increase visible choice/clutter — nest sensibly behind existing entry points. Preserve the calm, focused, low-saturation, technophobe-friendly feel and match the existing look exactly. A clean, focused interface matters more than exposing every function. When unsure how something fits the UI, propose a plan first rather than bolting on controls.
- **A change is NOT done until it is committed AND pushed to GitHub (`git push origin main`).** After every change meant for the live site, run the push yourself, confirm local and remote are in sync, and state in your summary whether the change is now live and which URL to test. Never end a task with unpushed commits. URLs to test: frontend → `https://ope-forecast-bngx.vercel.app`, backend health → `https://ope-forecast.onrender.com/health`.

## Commands
(To be filled in once scaffolded.)
- Backend dev server: `uvicorn app.main:app --reload` (from `backend/`)
- Backend tests: `pytest` (from `backend/`)
- Web dev server: `npm run dev` (from `web/`)

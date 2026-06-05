# Ope — *Know Tomorrow, Today*

Ope is a decision tool for small, variable-demand businesses (cafés, restaurants, florists, grocers, bakeries). Owners record what sells — either as end-of-day totals or by tapping a button for each sale — and Ope turns that data, plus the owner's own knowledge of their world, into concrete decisions: how much of each product to order, how many staff to schedule, whether an ad or event paid off, and alerts when the pattern is drifting.

Forecasting is the engine, not the headline. The lasting value is in **decisions and change-detection**, not in predicting a number the owner already knows by heart.

## What it does

- **Demand forecasting** — by day of week, per product and for total customers, using an ensemble of methods that re-weights itself against actual results.
- **Ordering recommendations** — how much of each product to order (reorder point + safety stock), constrained by each product's storage capacity and shelf life.
- **Staffing advice** — how many people to schedule per shift from hourly arrival patterns, including what adding or removing one worker does to wait times.
- **Busy-hours analysis** — tomorrow's expected peak hours and a per-weekday pattern, built from tap-recorded sales.
- **Ad / event measurement** — measures lift against a no-event baseline so an owner can see whether a promotion actually worked.
- **Owner-taught context** — declare recurring patterns (e.g. a weekly school-trip rush), mark anomalies to ignore, and track regular customers and their lifetime value. The more the owner teaches Ope, the better it fits their business.
- **Change-detection** — plain-language alerts when demand drifts or a day looks unusual.

## Architecture

Ope is **API-first**: all business logic and forecasting live in the backend behind a JSON API, so multiple clients (web today, mobile later, a Telegram bot) can share the same brain.

- **Backend** — Python + FastAPI. The forecasting engine is a set of pure, test-driven functions (no framework or database dependencies) covering moving averages, exponential smoothing, Holt-Winters, regression/trend, seasonality, accuracy metrics (MAD, MSE, MAPE, tracking signal), reorder point / safety stock, queueing (Little's Law, M/M/c), and IQR-based outlier detection.
- **Database** — Supabase (PostgreSQL), with authentication handled by Supabase (ES256 / JWKS verification).
- **Frontend** — React + Vite + TypeScript + Tailwind, with charts via Recharts. Calm, low-saturation design aimed at non-technical owners; supports English and Hebrew, light and dark modes.
- **Hosting** — backend on Render, frontend on Vercel.

## Project structure

```
ope-forecast/
├── backend/              # Python + FastAPI (the brain)
│   └── app/
│       ├── api/          # thin route handlers (validate -> call engine -> return)
│       ├── engine/       # pure, tested forecasting/ordering/queueing functions
│       ├── models/       # SQLAlchemy models
│       └── schemas/      # Pydantic request/response models
├── web/                  # React + Vite + TypeScript frontend
└── docs/                 # project specification and notes
```

## Running locally

**Backend** (from `backend/`):

```
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend** (from `web/`):

```
npm install
npm run dev
```

Both read configuration from local `.env` files (never committed). The backend needs a Supabase database connection and Supabase auth settings; the frontend needs the API base URL and Supabase public keys. See `.env.example` in each folder for the variable names.

## Tiers

The full feature set is free. Premium lifts limits rather than unlocking features:

- **Free** — one location, up to roughly a year of history, a generous allowance of one-off events, and the complete decision toolset.
- **Premium** — multiple locations (with the option to copy settings and products, but not data, to a new one), extended history, and more ad slots.

## Status

Actively developed. The web app is live; mobile and smart-register (POS) integration are planned. Roadmap and design decisions live in `docs/`.

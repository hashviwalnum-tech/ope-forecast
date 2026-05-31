# Ope – Deployment Setup Notes

## GitHub repository
https://github.com/omrienglander-tech/ope-forecast

---

## Backend — Render (Web Service)

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Instance Type | Free |

### Environment variables (names only — enter secret values manually in Render → Environment tab)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Supabase Postgres URI — Settings → Database → Connection string → URI |
| `SUPABASE_URL` | Yes | Supabase project URL — Settings → API |
| `ALLOWED_ORIGINS` | No | Comma-separated list of allowed frontend URLs; defaults to localhost:5173 if omitted |

**Live backend URL:** https://ope-forecast.onrender.com
**Health check:** https://ope-forecast.onrender.com/health → should return `{"status":"ok"}`
**API docs:** https://ope-forecast.onrender.com/docs

> Render free tier spins down after 15 min of inactivity. First request after idle takes ~30–60 s.

---

## Frontend — Vercel (Vite/React)

| Setting | Value |
|---|---|
| Root Directory | `web` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

### Environment variables (names only — enter values manually in Vercel → Settings → Environment Variables)

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | Full URL of the Render backend, no trailing slash |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL — Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key — Settings → API |

---

## After redeploying — CORS handshake

Whenever the frontend URL changes, update `ALLOWED_ORIGINS` in Render's Environment tab
to the new frontend URL, then save (Render redeploys automatically).

---

## Local development (no changes needed — keep running locally as before)

```
# Backend (http://localhost:8000)
cd backend
venv\Scripts\uvicorn app.main:app --reload

# Frontend (http://localhost:5173)
cd web
npm run dev
```

Local `.env` files are gitignored and never uploaded — keep them on this machine only.

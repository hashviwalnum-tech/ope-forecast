# Ope – Deployment Setup Notes

## GitHub repository
https://github.com/omrienglander-tech/ope-forecast

---

## Backend — Render (Web Service)

**Live URL:** https://ope-forecast.onrender.com
**Health check:** https://ope-forecast.onrender.com/health → `{"status":"ok"}`
**API docs:** https://ope-forecast.onrender.com/docs

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Instance Type | Free |

### Environment variables (names only — enter secret values in Render → Environment tab)

| Variable | Required | Where to get the value |
|---|---|---|
| `DATABASE_URL` | Yes | Supabase → Settings → Database → Connection string → URI |
| `SUPABASE_URL` | Yes | Supabase → Settings → API → Project URL |
| `ALLOWED_ORIGINS` | No | The Vercel frontend URL (see below); defaults to localhost:5173 if omitted |

**Current `ALLOWED_ORIGINS` value:** `https://ope-forecast-bngx.vercel.app`

> Render free tier spins down after 15 min of inactivity. First request after idle takes ~30–60 s.
> If the frontend URL ever changes (e.g. custom domain), update `ALLOWED_ORIGINS` in Render → Environment and save — Render redeploys automatically.

---

## Frontend — Vercel (Vite / React)

**Live URL:** https://ope-forecast-bngx.vercel.app

| Setting | Value |
|---|---|
| Root Directory | `web` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

### Environment variables (names only — enter values in Vercel → Project → Settings → Environment Variables)

| Variable | Required | Where to get the value |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | The Render backend URL (`https://ope-forecast.onrender.com`) |
| `VITE_SUPABASE_URL` | Yes | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase → Settings → API → Project API keys → anon / public |

---

## Local development (unchanged — still works as before)

```
# Backend  →  http://localhost:8000
cd backend
venv\Scripts\uvicorn app.main:app --reload

# Frontend  →  http://localhost:5173
cd web
npm run dev
```

Local `.env` files are gitignored and never uploaded — keep them on this machine only.

---

## Redeployment checklist

1. Push changes to `main` on GitHub — both Render and Vercel redeploy automatically.
2. If the frontend URL changes, update `ALLOWED_ORIGINS` on Render.
3. If Supabase credentials change, update them on both Render and Vercel.
4. Health check after any backend redeploy: https://ope-forecast.onrender.com/health

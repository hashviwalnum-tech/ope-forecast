-- ============================================================================
-- Enable Row Level Security on EVERY table.
--
-- WHY THIS IS URGENT
-- ------------------
-- The Supabase anon key is published by design: it is compiled into every web
-- bundle and every mobile build, and it is committed to this repo in
-- mobile/.env. That is normal and safe *only* when RLS is on, because RLS —
-- not secrecy — is what stops that key reading the database.
--
-- RLS was enabled on the original tables but never on any table added since.
-- Probing the live project with the published anon key on 2026-08-18 found
-- these readable, writable and deletable by anyone:
--
--     subscriptions    -- user_id, tier, trial dates, provider subscription ids
--     telegram_links   -- business_id, chat_id, and the one-time link_code
--     order_records    -- reorder history
--     stock_batches    -- stock levels and expiry
--
-- subscriptions is the table the entire entitlement system now reads from, so
-- an open subscriptions table means anyone can grant themselves premium. And
-- telegram_links.link_code is the secret that binds a Telegram chat to a
-- business, so an open telegram_links table means anyone can point a business's
-- bot at their own chat.
--
-- WHAT THIS DOES
-- --------------
-- Enables RLS on every table and creates NO policies. With RLS on and no
-- policy, PostgREST returns nothing to anon and authenticated callers — which
-- is exactly right here, because no client ever talks to PostgREST. The web
-- app, the mobile app and the Telegram bot all go through the FastAPI backend,
-- which connects with the Supabase Postgres role and therefore bypasses RLS.
--
-- Deliberately NOT using FORCE ROW LEVEL SECURITY: FORCE applies RLS to the
-- table owner too, which would cut the backend off from its own data.
--
-- SAFE TO RE-RUN. Enabling RLS on a table that already has it is a no-op.
--
-- HOW TO APPLY
-- ------------
--   Supabase Dashboard -> SQL Editor -> paste -> Run.
--   Then run migrations/002_verify_rls.sql and confirm every row says ENABLED.
--   Then re-run: python -m tests.deployment.probe_rls   (from backend/)
-- ============================================================================

ALTER TABLE IF EXISTS public.businesses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.day_records           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sale_records          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sale_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.regulars              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.regular_daily_spends  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.periods               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.recurring_patterns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.forecast_runs         ENABLE ROW LEVEL SECURITY;

-- The four confirmed open on 2026-08-18:
ALTER TABLE IF EXISTS public.order_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stock_batches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.subscriptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.telegram_links        ENABLE ROW LEVEL SECURITY;

-- Later additions, same story — enabling regardless:
ALTER TABLE IF EXISTS public.service_consumables   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.booked_counts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.service_booked_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tuner_state           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tuner_log             ENABLE ROW LEVEL SECURITY;

-- Defence in depth: even if a policy is ever added by accident, these roles
-- have no business touching application tables directly. The backend does not
-- use either role — it connects with the Postgres role from DATABASE_URL.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

-- And stop future tables from being exposed the moment they are created.
-- This is the actual root cause: RLS had to be *remembered* for each new table.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;

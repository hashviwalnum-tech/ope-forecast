-- ============================================================================
-- Verify RLS after running 001_enable_rls_all_tables.sql.
--
-- Run in the Supabase SQL Editor. EVERY row must read "ENABLED".
-- Anything showing "*** OPEN ***" is readable and writable by anyone holding
-- the anon key — which is published in every web and mobile build.
-- ============================================================================

SELECT
    c.relname                              AS table_name,
    CASE WHEN c.relrowsecurity
         THEN 'ENABLED'
         ELSE '*** OPEN — anyone with the anon key can read and write this ***'
    END                                    AS rls_status,
    COALESCE(p.policy_count, 0)            AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN (
    SELECT schemaname, tablename, COUNT(*) AS policy_count
    FROM pg_policies
    GROUP BY schemaname, tablename
) p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relrowsecurity ASC, c.relname;

-- Expected after the migration: every table ENABLED, every table 0 policies.
--
-- Zero policies is intentional, not an oversight. No client talks to PostgREST
-- — the web app, the mobile app and the Telegram bot all go through the FastAPI
-- backend, which connects as the Postgres role and bypasses RLS. So "RLS on,
-- no policies" is the tightest correct setting: it denies the published anon
-- key everything, and changes nothing for the backend.
--
-- If you later want a client to query Supabase directly, that is when you add
-- per-tenant policies — and each one needs its own test.

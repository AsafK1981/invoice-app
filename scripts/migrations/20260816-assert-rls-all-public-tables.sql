-- ============================================================================
-- Row Level Security on EVERY public table - tracked and enforced (2026-08-16)
--
-- Reproducibility gap: the original bootstrap (supabase-schema.sql) explicitly
-- DISABLED RLS on the core tables and the ENABLE statements were applied by
-- hand later; no file in scripts/migrations/ turns RLS on for businesses /
-- clients / products / documents / document_items / expenses /
-- document_counters. A project rebuilt from tracked migrations alone would
-- therefore come up with those tables open to the anon key. Production is
-- correct today (checked 2026-08-16: all 25 public tables relrowsecurity =
-- true); this file makes that state re-creatable and future-proof.
--
-- Effect: enables RLS on every ordinary table in schema public that doesn't
-- have it. A table with RLS and no policies is reachable only by the service
-- role (Postgres default-deny), which is the safe default for a new table
-- until its policies are written. Also blocks the table owner via FORCE?
-- No - the app's server code connects as postgres/service_role and must
-- bypass RLS, so FORCE ROW LEVEL SECURITY is deliberately NOT set.
--
-- The weekly cron /api/cron/db-audit re-checks this and fails loudly if a
-- public table without RLS ever appears.
--
-- Idempotent. Apply with: node scripts/run-sql-file.mjs scripts/migrations/20260816-assert-rls-all-public-tables.sql
-- ============================================================================

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    RAISE NOTICE 'RLS enabled on public.%', t.relname;
  END LOOP;
END $$;

-- Explicit, greppable list for the core tables so nobody has to trust the loop.
ALTER TABLE public.businesses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;

-- Reporter for the weekly db-audit cron: which public tables lack RLS?
-- SECURITY DEFINER because pg_class visibility for the service role is fine
-- but we want one stable, minimal surface. Callable by service_role only
-- (see security_secdef_rpc_grants: new SECURITY DEFINER fns are
-- PostgREST-callable by default, so revoke from everyone else).
CREATE OR REPLACE FUNCTION public.tables_without_rls()
RETURNS TABLE (table_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT c.relname::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = false
  ORDER BY 1;
$$;
REVOKE EXECUTE ON FUNCTION public.tables_without_rls() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tables_without_rls() TO service_role;

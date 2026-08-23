-- Revoke public EXECUTE on the SECURITY DEFINER trigger functions.
--
-- PostgreSQL grants EXECUTE to PUBLIC on new functions, and Supabase also
-- grants it to `anon` and `authenticated`. That makes these functions callable
-- over PostgREST, e.g.:
--
--   POST /rest/v1/rpc/enforce_document_item_immutability
--   POST /rest/v1/rpc/rls_auto_enable
--
-- All three are trigger / event-trigger functions: called directly over RPC
-- they have no useful effect (Postgres rejects a trigger function invoked
-- outside trigger context), so this was never an exploitable path, only a
-- lint-flagged exposure (Supabase advisor 0028/0029). Still, these functions
-- have no business being in the public API surface. Only the trigger machinery
-- (postgres/service_role) needs them. REVOKE EXECUTE does NOT affect trigger
-- firing (triggers run as the table owner regardless of the grant).
--
-- Found by the CSO audit on 2026-08-23. Mirrors the pattern already used for
-- the usage-cap RPCs in 20260809-revoke-usage-rpc-from-public.sql. Applied to
-- production the same day; committed so a rebuild/restore reapplies it.
-- (enforce_document_immutability, the older 2026-08-07 sibling, was added to
-- this migration in the same audit for consistency.)

REVOKE EXECUTE ON FUNCTION public.enforce_document_item_immutability() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_document_immutability() FROM PUBLIC, anon, authenticated;

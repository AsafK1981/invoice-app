-- Close a quota-tampering hole on both usage-cap RPCs.
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, and
-- Supabase additionally grants it to `anon` and `authenticated`. Both
-- increment_* functions are SECURITY DEFINER and take p_user_id as a plain
-- argument, so anyone holding the anon key (it ships in the browser bundle -
-- it is public by design) could call them over PostgREST:
--
--   POST /rest/v1/rpc/increment_assistant_usage
--   {"p_user_id": "<someone else's uuid>", "p_month": "2026-08"}
--
-- Repeated calls push a chosen user to their monthly cap and lock them out of
-- the assistant / receipt scanning, and calls with random UUIDs grow the usage
-- tables without bound. No data is disclosed - the tables are RLS-denied and
-- the functions return only a counter - so this is tampering and denial of
-- service, not a leak.
--
-- Only the API routes need these, and they run with the service-role key, so
-- every other role can lose EXECUTE. Found by the external GPT council seat on
-- 2026-08-09; increment_expense_scan_usage has carried the same hole since
-- 2026-08-03, which is why it is fixed here too.

REVOKE ALL ON FUNCTION increment_assistant_usage(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION increment_expense_scan_usage(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION increment_assistant_usage(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION increment_expense_scan_usage(uuid, text) TO service_role;

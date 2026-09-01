-- ============================================================================
-- admin_access_log (2026-08-31)
--
-- Operator access journal. `audit_log` records what a USER did inside their own
-- tenant (and is RLS-scoped to that tenant). This table records the opposite:
-- every time the platform operator reaches across tenants, through any of the
-- four doors that exist.
--
--   admin_ui   the /admin dashboard in the browser
--   admin_api  a route under /api/admin/* (logged after the admin check passes)
--   script     a service-role script under scripts/ (see scripts/admin.mjs)
--   sql        free-form SQL through the Management API (scripts/run-sql.mjs)
--
-- Why it exists: תקנות הגנת הפרטיות (אבטחת מידע) 2017 require access control and
-- access recording for a database of this kind, and the privacy policy now says
-- operator access is logged. Nothing enforced that claim before this table.
--
-- RLS is enabled with NO policies at all, on purpose. That is not an oversight:
-- with RLS on and zero policies, `anon` and `authenticated` can neither read nor
-- write a single row, while the service role (which bypasses RLS) can. The log
-- must not be readable or forgeable by any browser session, including the
-- operator's own signed-in session - the operator writes to it through server
-- routes holding the service key, never directly from the client.
--
-- `detail` is jsonb and deliberately holds metadata only (argv, reason, counts).
-- Never put customer content in it: the point of the whole change is that the
-- operator stops handling tenant content, so the audit trail must not become the
-- new place where that content accumulates.
--
-- Idempotent. Apply with:
--   node scripts/run-sql-file.mjs scripts/migrations/20260831-admin-access-log.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who reached in. The signed-in admin's email for UI/API access, or a stable
  -- CLI identity for scripts. Free text (not an FK to auth.users) so a row
  -- survives the deletion of the account it names: an access record that can be
  -- erased by deleting the actor is not an access record.
  actor text NOT NULL,

  channel text NOT NULL CHECK (channel IN ('admin_ui', 'admin_api', 'script', 'sql')),

  -- What was done: route + method for admin_api, script basename for script,
  -- a short verb for the UI. Not an enum - a new door must be loggable without
  -- a migration, and an unrecognized action string is still better than none.
  action text NOT NULL,

  -- Filled only when the access was aimed at ONE tenant (concierge import,
  -- support on a named account). Aggregate reads leave both null.
  target_user_id uuid,
  target_business_id uuid,

  -- Metadata only. See the header note.
  detail jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- The only read pattern: "what happened recently", newest first.
CREATE INDEX IF NOT EXISTS admin_access_log_created_at_idx
  ON admin_access_log (created_at DESC);

ALTER TABLE admin_access_log ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: service-role only. See the header comment.

-- Belt and suspenders on top of default-deny RLS: Supabase's default privileges
-- GRANT table access to anon/authenticated on new tables, and while zero
-- policies already blocks every row, revoking the grant outright means a future
-- "helpful" policy on this table cannot quietly open it either.
REVOKE ALL ON admin_access_log FROM anon, authenticated;

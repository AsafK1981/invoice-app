-- ============================================================================
-- Friendly reminder BEFORE the due date (2026-09-16).
--
-- An optional email to the client a few days before a document's own
-- "לתשלום עד" (documents.due_date), like iCount's "הנודניק". The daily
-- dunning run (src/app/api/dunning/run/route.ts) sends it once per document
-- when the document is an open receivable, its due date is 1 to 5 days away,
-- and the due date is at least 7 days after the issue date. It rides on the
-- email pass only: nothing happens unless dunning_enabled is also true.
--
-- WHAT CHANGES
--
--  1. businesses.dunning_pre_due_enabled - opt-in switch, default false. This
--     one DOES send to the client on its own, so it starts off, like
--     dunning_enabled. Protection mirrors dunning_enabled and
--     dunning_whatsapp_enabled exactly: the existing owner UPDATE policy
--     "Users can update own businesses" (user_id = auth.uid()) covers it.
--     businesses has no column grants, no immutability trigger and no
--     SECURITY DEFINER whitelist, so there is nothing else to extend.
--
--  2. dunning_log.day_bucket accepts -5. The value means "the friendly
--     reminder sent before the due date" (PRE_DUE_BUCKET in
--     src/lib/dunning-copy.ts); 3 / 14 / 30 stay the days-late stages. The
--     pre-due email is claimed, released and confirmed in dunning_log exactly
--     like a stage email (channel 'email'), and the UNIQUE (document_id,
--     day_bucket, channel) key keeps it to one send per document.
--     The CHECK is dropped and re-added under the SAME name
--     (dunning_log_day_bucket_check). Every existing row holds 3, 14 or 30,
--     so the re-add validates.
--
-- APPLY BEFORE DEPLOYING THE CODE THAT SHIPS WITH IT.
--   * The route selects dunning_pre_due_enabled by name. Without the column
--     that query errors and the WHOLE daily run does nothing ("no businesses
--     opted in"): no stage emails, no WhatsApp notifications, until applied.
--   * Without the widened CHECK, every pre-due claim insert is rejected, so
--     nothing is sent (fails closed) but each run reports an error per
--     document. The route tests run against an in-memory mock of Supabase
--     that does NOT enforce CHECK constraints, so no test can catch a missing
--     migration here. This file must be applied first.
--
--   node scripts/run-sql-file.mjs --reason "pre-due friendly reminder: businesses column + dunning_log bucket -5" scripts/migrations/20260916-dunning-pre-due.sql
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. businesses.dunning_pre_due_enabled ───────────────────────────────────

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS dunning_pre_due_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.businesses.dunning_pre_due_enabled IS
  'When true AND dunning_enabled is true, the daily dunning run emails the client one friendly reminder 1 to 5 days before a document''s own due_date (only when due_date is at least 7 days after the issue date). Logged in dunning_log with day_bucket = -5.';

-- ── 2. dunning_log.day_bucket accepts -5 ────────────────────────────────────

ALTER TABLE public.dunning_log
  DROP CONSTRAINT IF EXISTS dunning_log_day_bucket_check;

ALTER TABLE public.dunning_log
  ADD CONSTRAINT dunning_log_day_bucket_check
  CHECK (day_bucket IN (-5, 3, 14, 30));

COMMENT ON COLUMN public.dunning_log.day_bucket IS
  '3 / 14 / 30 = the reminder stage, in days late (past due_date when the document states one, else since issue). -5 = the friendly reminder emailed before the due date (businesses.dunning_pre_due_enabled). One row per (document_id, day_bucket, channel).';

NOTIFY pgrst, 'reload schema';

COMMIT;

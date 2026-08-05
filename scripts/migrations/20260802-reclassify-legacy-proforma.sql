-- 20260802-reclassify-legacy-proforma.sql
--
-- ⚠️ APPLIED TO PRODUCTION 2026-08-02 10:22 UTC — DO NOT RUN AGAIN.
-- Verified 2026-08-05 against live DB: all 3 docs are type='proforma',
-- audit_log row d7ddccd7 (action 'document.type_reclassified') exists, and
-- document_counters.proforma has since advanced to 90006 (doc 90005 was
-- issued 2026-08-02). Re-running would reset the counter to 90005 — a number
-- already taken — and break the next proforma issuance for this business
-- (UNIQUE(business_id, type, number)). Committed for the historical record.
--
-- WHY
-- Commit 37d1883 relabelled document type 'quote' from "cheshbonit iska"
-- (proforma / demand for payment) to "hatza'at mechir" (price quote), and
-- introduced a new type 'proforma' carrying the old "cheshbonit iska" label.
-- The commit shipped WITHOUT a data migration, so rows created under the old
-- semantics kept type='quote' and silently changed meaning in the UI and in
-- every re-rendered PDF / public link.
--
-- AFFECTED (business dc3b5b61-7de6-435a-8034-5f93cbfb090b, client "Tim Teddy Ltd"):
--   number 90002  id d9078571-8c66-46d9-b498-19966c8c5ac4  status paid
--   number 90003  id 9971f023-440c-4329-9736-c3a143d7bd54  status paid
--   number 90004  id 4f13c004-ab9d-4533-9c23-8fee34cb7664  status paid
-- All three were issued and emailed as "cheshbonit iska" and each is already
-- converted to a receipt (converted_to_id set). They must read 'proforma'.
--
-- DELIBERATELY EXCLUDED: business acf71faa-d769-4881-b707-d1d03fa89101
-- (numbers 201, 202). Different real user, those documents were never emailed
-- as "cheshbonit iska", and their quote series stays a quote series.
--
-- COUNTERS
-- After the move, the proforma series for dc3b5b61 owns 90001..90004, so its
-- counter advances to 90005 (it currently reads 90002 because only 90001 was
-- ever a native proforma). The quote series for dc3b5b61 no longer has any
-- rows; it is restarted at 50001 so future quotes are unambiguously new and
-- can never collide with the 9000x proforma block.
--
-- TRIGGER
-- public.documents carries BEFORE UPDATE trigger
-- trg_enforce_document_immutability, which rejects any change to `type` on a
-- non-draft row. It is disabled and re-enabled INSIDE the transaction, so a
-- failure anywhere rolls the disable back with everything else - the trigger
-- can never be left off. Must run as table owner (postgres), i.e. through
-- scripts/run-sql.mjs (Supabase Management API), not via PostgREST/service_role.
--
-- Validated by multi-model council, 2026-08-02. One-shot corrective migration.

BEGIN;

CREATE TEMP TABLE _migration_report (step text, rows_affected bigint);

ALTER TABLE public.documents DISABLE TRIGGER trg_enforce_document_immutability;

WITH u AS (
  UPDATE public.documents
     SET type = 'proforma'
   WHERE business_id = 'dc3b5b61-7de6-435a-8034-5f93cbfb090b'
     AND type = 'quote'
     AND number IN (90002, 90003, 90004)
  RETURNING 1
)
INSERT INTO _migration_report SELECT 'documents quote->proforma', count(*) FROM u;

ALTER TABLE public.documents ENABLE TRIGGER trg_enforce_document_immutability;

WITH u AS (
  UPDATE public.document_counters
     SET next_number = 90005
   WHERE business_id = 'dc3b5b61-7de6-435a-8034-5f93cbfb090b'
     AND doc_type = 'proforma'
  RETURNING 1
)
INSERT INTO _migration_report SELECT 'counter proforma -> 90005', count(*) FROM u;

WITH u AS (
  UPDATE public.document_counters
     SET next_number = 50001
   WHERE business_id = 'dc3b5b61-7de6-435a-8034-5f93cbfb090b'
     AND doc_type = 'quote'
  RETURNING 1
)
INSERT INTO _migration_report SELECT 'counter quote -> 50001', count(*) FROM u;

WITH a AS (
  INSERT INTO public.audit_log (business_id, action, target_type, target_id, target_label, payload)
  VALUES (
    'dc3b5b61-7de6-435a-8034-5f93cbfb090b',
    'document.type_reclassified',
    'migration',
    '20260802-reclassify-legacy-proforma',
    'documents 90002, 90003, 90004: quote -> proforma',
    jsonb_build_object(
      'reason', 'commit 37d1883 relabelled quote to price-quote and added proforma without migrating pre-existing rows; these three were issued and emailed as cheshbonit iska',
      'old_type', 'quote',
      'new_type', 'proforma',
      'documents', jsonb_build_array(
        jsonb_build_object('id', 'd9078571-8c66-46d9-b498-19966c8c5ac4', 'number', 90002),
        jsonb_build_object('id', '9971f023-440c-4329-9736-c3a143d7bd54', 'number', 90003),
        jsonb_build_object('id', '4f13c004-ab9d-4533-9c23-8fee34cb7664', 'number', 90004)
      ),
      'counters', jsonb_build_object('proforma', 90005, 'quote', 50001),
      'excluded_business', 'acf71faa-d769-4881-b707-d1d03fa89101',
      'immutability_trigger', 'trg_enforce_document_immutability disabled and re-enabled inside this transaction',
      'validated_by', 'multi-model council 2026-08-02'
    )
  )
  RETURNING 1
)
INSERT INTO _migration_report SELECT 'audit_log insert', count(*) FROM a;

COMMIT;

SELECT step, rows_affected FROM _migration_report ORDER BY step;

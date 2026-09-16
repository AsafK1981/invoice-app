-- No issued document may ever sit at or above its type's counter.
--
-- Context: the import paths write historical documents with their original
-- numbers and then, as a SEPARATE step, raise document_counters past the
-- highest one (bump_document_counter, migration 20260916). Two separate steps
-- leave a window: a closed tab, a cancelled request or a killed server between
-- them commits the documents and never raises the counter, and the next live
-- document is handed a number that already exists. The coding council flagged
-- that window after everything else in the defect class was closed.
--
-- This moves the invariant into the database, where no client behaviour can
-- skip it. Two triggers, because a document becomes "issued" in two ways:
--
--   1. INSERTED already issued (imports, and every live issuance path).
--      Statement-level, over the transition table.
--   2. UPDATED from draft to issued. A draft may carry a real number - an
--      import can bring one in as a draft with its source number - and then be
--      issued by a status UPDATE that never touches the counter. Row-level,
--      because Postgres does not allow a transition table on a trigger with an
--      UPDATE OF column list.
--
-- In both, if the counter cannot be raised, the document write fails too.
--
-- WHY THIS CHANGES NOTHING FOR LIVE ISSUANCE
-- Every live path already takes its number from the counter, and verified
-- against the LIVE pg_proc bodies, not only the repo files:
--   - create_document_atomic, automatic number: advances next_number by one,
--     then inserts that number. GREATEST(N + 1, N + 1) is a no-op.
--   - create_document_atomic, custom number (p_number): already runs
--       ON CONFLICT ... SET next_number = GREATEST(next_number, p_number + 1)
--     This repeats it: no-op.
--   - create_document_for_bot (WhatsApp) advances the counter before inserting.
--   - the service-role self-invoice (documents-server.ts) takes its number from
--     get_next_doc_number, which advances the counter.
--   - cancel_document_atomic only UPDATEs, and never from draft.
-- So the only writes these triggers actually change are the ones that bypass
-- the counter: the imports, and a draft issued by UPDATE.
--
-- WHY DRAFT INSERTS ARE SKIPPED
-- A draft created in the editor carries a placeholder number that never came
-- from the counter (production has one, numbered 1). Raising the counter for
-- it would skip real numbers. A draft only counts once it is issued, which is
-- what trigger 2 catches.
--
-- ORDER BY in trigger 1: two concurrent multi-type imports for one business
-- would otherwise lock counter rows in whatever order the hash aggregate
-- produced and could deadlock (40P01). A fixed order removes that.
--
-- SECURITY INVOKER: the upsert runs as whoever wrote the document. For a
-- signed-in user the document_counters RLS (own business only) still applies,
-- and its predicate is the same one documents' own INSERT policy uses, so any
-- insert that passes documents RLS also passes this. The SECURITY DEFINER
-- issuing functions and service_role bypass RLS, exactly as their own direct
-- counter writes already do. anon cannot write documents at all.
--
-- Wrapped in a transaction with bounded locks, like
-- 20260908-documents-no-delete-once-numbered.sql: CREATE TRIGGER takes a lock
-- on public.documents, and a 5s lock_timeout makes this fail fast on a busy
-- table instead of queueing behind every reader and blocking them.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- Apply with: node scripts/run-sql-file.mjs scripts/migrations/20260916-raise-counters-after-document-insert.sql
-- Verified on real Postgres first: tests/document-counter-trigger.mjs

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Documents inserted already issued -------------------------------------

CREATE OR REPLACE FUNCTION public.raise_counters_after_document_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.document_counters (business_id, doc_type, next_number)
  SELECT ins.business_id, ins.type, max(ins.number) + 1
  FROM inserted AS ins
  WHERE ins.status <> 'draft'
    AND ins.number IS NOT NULL
  GROUP BY ins.business_id, ins.type
  ORDER BY ins.business_id, ins.type
  ON CONFLICT (business_id, doc_type)
  DO UPDATE SET next_number = GREATEST(public.document_counters.next_number, EXCLUDED.next_number);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.raise_counters_after_document_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.raise_counters_after_document_insert() FROM anon;

DROP TRIGGER IF EXISTS trg_raise_counters_after_document_insert ON public.documents;
CREATE TRIGGER trg_raise_counters_after_document_insert
  AFTER INSERT ON public.documents
  REFERENCING NEW TABLE AS inserted
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.raise_counters_after_document_insert();

-- 2. A draft issued by UPDATE ---------------------------------------------

CREATE OR REPLACE FUNCTION public.raise_counter_on_draft_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.document_counters (business_id, doc_type, next_number)
  VALUES (NEW.business_id, NEW.type, NEW.number + 1)
  ON CONFLICT (business_id, doc_type)
  DO UPDATE SET next_number = GREATEST(public.document_counters.next_number, EXCLUDED.next_number);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.raise_counter_on_draft_issue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.raise_counter_on_draft_issue() FROM anon;

-- The number cannot change after issuance (enforce_document_immutability
-- freezes it), so the value NEW.number holds at the moment status leaves
-- 'draft' is final. Changing number while still a draft does not fire this;
-- the status transition that follows does, with the number it ended up with.
DROP TRIGGER IF EXISTS trg_raise_counter_on_draft_issue ON public.documents;
CREATE TRIGGER trg_raise_counter_on_draft_issue
  AFTER UPDATE OF status ON public.documents
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status <> 'draft' AND NEW.number IS NOT NULL)
  EXECUTE FUNCTION public.raise_counter_on_draft_issue();

COMMIT;

-- Rollback (kept here so it is never a guess):
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DROP TRIGGER IF EXISTS trg_raise_counters_after_document_insert ON public.documents;
--   DROP TRIGGER IF EXISTS trg_raise_counter_on_draft_issue ON public.documents;
--   DROP FUNCTION IF EXISTS public.raise_counters_after_document_insert();
--   DROP FUNCTION IF EXISTS public.raise_counter_on_draft_issue();
--   COMMIT;

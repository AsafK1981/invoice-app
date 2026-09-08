-- ============================================================================
-- קובץ קבוע: a document that received a number can never be deleted (2026-09-08)
--
-- הוראות מס הכנסה (ניהול פנקסי חשבונות), הגדרת "קובץ קבוע": "קובץ אשר
-- מתקיימים בו כל אלה: 1. אין אפשרות למחוק בו רשומה; 2. הרשומות בו מוספרו
-- באופן אוטומטי במספור עוקב", and סעיף 23(ב): a record "אין לשנות או לתקן
-- אלא באמצעות תיעוד נוסף". Reversing an issued document is therefore a
-- credit note (חשבונית זיכוי), never a delete.
--
-- What changes vs 20260807-documents-immutability-no-draft-revert.sql (the
-- previous CANONICAL definition, whose body is copied here verbatim):
--
--   1. DELETE branch. Was keyed on OLD.emailed_at IS NOT NULL, i.e. an
--      issued-but-never-emailed document could still be deleted - which tore
--      a hole in a numbering sequence the law requires to be unbroken (and is
--      exactly what the "בדיקת רצף מספור" report now reports on). The gate is
--      now OLD.status: only a draft, which never took a number, may go.
--
--   2. UPDATE branch, two columns added to the 18 already guarded:
--      * client_id - the identity of the party the document was issued to.
--        Re-pointing an issued document at a different customer is forbidden.
--        A change TO NULL is still allowed, because
--        20260908-document-client-isolation.sql gives documents_client_business_fkey
--        ON DELETE SET NULL (client_id): deleting a customer from the address
--        book legitimately nulls the link on historical documents. That is a
--        contacts event, not a change to the invoice, and the frozen
--        client_name/client_tax_id snapshot on the row is what the books read.
--        (Same carve-out, and same reasoning, as product_id in
--        20260816-document-items-immutability.sql.)
--      * allocation_number - מספר הקצאה. NULL -> value stays allowed: the
--        number arrives from רשות המסים after the document is issued and the
--        app writes it in a follow-up UPDATE. Once set it is frozen.
--
-- The account-wipe carve-out (current_user)
--   /api/delete-account and /api/danger/delete-all wipe a user's data on
--   their own explicit request, using SUPABASE_SERVICE_ROLE_KEY. PostgREST
--   SETs ROLE service_role for those calls, so current_user = 'service_role'
--   inside this trigger, and they are let through. Under the previous rule
--   they got through by nulling emailed_at first (see the comments in both
--   routes); status cannot be nulled the same way, since an issued document
--   may never be reverted to draft, so the exemption has to be explicit.
--   'postgres' is exempt for the same reason a table owner always is in
--   practice (restores, migrations, the SQL editor) - it could disable the
--   trigger regardless. Every ordinary app write runs as `authenticated` and
--   is fully bound by the rule.
--   Note: the emailed_at nulling in those two routes is now redundant. It is
--   harmless and was left in place; it is not what lets them through.
--
-- ONE trigger, not two: trg_enforce_document_immutability is already
-- BEFORE UPDATE OR DELETE on public.documents, so both branches live in this
-- one function. Adding a separate BEFORE DELETE trigger would only make two
-- guards fire for the same row.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- Apply with: node scripts/run-sql-file.mjs scripts/migrations/20260908-documents-no-delete-once-numbered.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_document_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status IS DISTINCT FROM 'draft'
       AND current_user NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION
        'numbered documents cannot be deleted; cancel via credit note';
    END IF;
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.status IS DISTINCT FROM 'draft' THEN
    IF NEW.status = 'draft' THEN RAISE EXCEPTION 'issued documents cannot be reverted to draft'; END IF;
    IF NEW.number       IS DISTINCT FROM OLD.number       THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'number'; END IF;
    IF NEW.type         IS DISTINCT FROM OLD.type         THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'type'; END IF;
    IF NEW.date         IS DISTINCT FROM OLD.date         THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'date'; END IF;
    IF NEW.subtotal     IS DISTINCT FROM OLD.subtotal     THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'subtotal'; END IF;
    IF NEW.vat          IS DISTINCT FROM OLD.vat          THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'vat'; END IF;
    IF NEW.total        IS DISTINCT FROM OLD.total        THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'total'; END IF;
    IF NEW.rounding     IS DISTINCT FROM OLD.rounding     THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'rounding'; END IF;
    IF NEW.round_total  IS DISTINCT FROM OLD.round_total  THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'round_total'; END IF;
    IF NEW.subtotal_ils IS DISTINCT FROM OLD.subtotal_ils THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'subtotal_ils'; END IF;
    IF NEW.vat_ils      IS DISTINCT FROM OLD.vat_ils      THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'vat_ils'; END IF;
    IF NEW.total_ils    IS DISTINCT FROM OLD.total_ils    THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'total_ils'; END IF;
    IF NEW.currency     IS DISTINCT FROM OLD.currency     THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'currency'; END IF;
    IF NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'exchange_rate'; END IF;
    IF NEW.zero_rated   IS DISTINCT FROM OLD.zero_rated   THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'zero_rated'; END IF;
    IF NEW.client_name  IS DISTINCT FROM OLD.client_name  THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'client_name'; END IF;
    IF NEW.withholding_rate   IS DISTINCT FROM OLD.withholding_rate   THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'withholding_rate'; END IF;
    IF NEW.withholding_amount IS DISTINCT FROM OLD.withholding_amount THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'withholding_amount'; END IF;
    IF NEW.discount_amount    IS DISTINCT FROM OLD.discount_amount    THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'discount_amount'; END IF;
    -- Added 2026-09-08. NULL-ing client_id is the FK's ON DELETE SET NULL, see header.
    IF NEW.client_id IS DISTINCT FROM OLD.client_id AND NEW.client_id IS NOT NULL THEN
      RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'client_id';
    END IF;
    -- Added 2026-09-08. First write (NULL -> value) is how מספר הקצאה arrives.
    IF OLD.allocation_number IS NOT NULL
       AND NEW.allocation_number IS DISTINCT FROM OLD.allocation_number THEN
      RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'allocation_number';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_document_immutability ON public.documents;

CREATE TRIGGER trg_enforce_document_immutability
  BEFORE UPDATE OR DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_document_immutability();

-- CREATE OR REPLACE keeps the existing ACL, but re-assert it so a rebuild from
-- this file alone lands in the same state as 20260823-revoke-trigger-fn-execute.sql.
REVOKE EXECUTE ON FUNCTION public.enforce_document_immutability() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_document_immutability() IS
  'DB-level guard: a document that left status=draft can never be deleted (only an account wipe running as service_role may), and its money/identity columns are frozen. See scripts/migrations/20260908-documents-no-delete-once-numbered.sql';

-- ============================================================================
-- CANONICAL definition of enforce_document_immutability().
--
-- This file REPLACES the function definitions in
--   20260705-documents-immutability-trigger.sql   (first version)
--   20260706-documents-immutability-rounding.sql  (added rounding guards)
-- Both are marked SUPERSEDED; re-running either would revert production.
--
-- Verified 2026-08-02: the function body below is BYTE-FOR-BYTE identical to
-- production's pg_proc.prosrc, and the live trigger is
--   CREATE TRIGGER trg_enforce_document_immutability
--     BEFORE DELETE OR UPDATE ON public.documents
--     FOR EACH ROW EXECUTE FUNCTION enforce_document_immutability()
-- (enabled, tgenabled='O'). If you change the function, update THIS file.
-- ============================================================================
--
-- Relax the document-immutability trigger's DELETE rule: allow deleting any
-- document that was NEVER emailed to the customer (emailed_at IS NULL) — this
-- covers drafts AND issued-but-unsent documents. A document that WAS delivered
-- (emailed_at IS NOT NULL) still cannot be hard-deleted: it must be cancelled
-- via a credit note.
--
-- Rebuilt from the live enforce_document_immutability() (2026-07-06,
-- 20260706-documents-immutability-rounding.sql). The ONLY change is the DELETE
-- branch: it now blocks on `OLD.emailed_at IS NOT NULL` instead of
-- `OLD.status <> 'draft'`. The UPDATE branch (financial/identity-field lock on
-- issued docs) is byte-for-byte identical and stays fully in force.
--
-- CURRENT SCOPE / column inventory (canonical; supersedes the 2026-07-05
-- snapshot in 20260705-documents-immutability-trigger.sql):
--
--   DELETE is blocked only when: emailed_at IS NOT NULL (document was actually
--     delivered). Drafts AND issued-but-never-sent documents are deletable.
--
--   IMMUTABLE (blocked on change when OLD.status <> 'draft'):
--     number, type, date,
--     subtotal, vat, total, rounding, round_total,
--     subtotal_ils, vat_ils, total_ils,
--     currency, exchange_rate, zero_rated, client_name
--
--   NOT CHECKED (the other 26 of the table's 41 columns, verified against
--   information_schema 2026-08-02 — this list is exhaustive):
--     id, business_id, client_id, created_at      (identity / FK, never rewritten
--                                                   by app code)
--     status, paid_at, payment_reference          (status/payment flows)
--     allocation_number, allocation_set_at         (חשבונית ישראל allocation)
--     converted_to_id                              (quote->receipt convert)
--     original_document_id, original_issued_at     (credit-note / copy linkage)
--     emailed_at, email_opened_at, email_open_count (email send/open tracking)
--     emailed_to                                   (recipients of the last send,
--                                                   added 20260802; rewritten on
--                                                   every resend, post-issue)
--     approved_at, approval_signature              (quote approval)
--     client_tax_id                                (DocumentCustomerTaxEditor
--                                                   fills the customer's ע.מ/ח.פ
--                                                   on an ALREADY-ISSUED invoice
--                                                   so an allocation number can
--                                                   be requested — v2 mandates
--                                                   customer_vat_number)
--     notes, subject, payment_method, payment_details (editable metadata)
--     withholding_rate, withholding_amount, discount_amount
--                                                  (added 20260719 — KNOWN GAP:
--                                                   these are financial fields
--                                                   that the trigger does NOT
--                                                   guard. Left as-is here on
--                                                   purpose; this file only
--                                                   documents production, it
--                                                   does not change it. Close
--                                                   the gap in a NEW migration
--                                                   if/when that is decided.)
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.enforce_document_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.emailed_at IS NOT NULL THEN
      RAISE EXCEPTION
        'delivered documents cannot be deleted; cancel via credit note';
    END IF;
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.status IS DISTINCT FROM 'draft' THEN
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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_document_immutability ON public.documents;

CREATE TRIGGER trg_enforce_document_immutability
  BEFORE UPDATE OR DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_document_immutability();

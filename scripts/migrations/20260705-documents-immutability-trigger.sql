-- Defense-in-depth: enforce Israeli-law document immutability at the DB level.
--
-- Issued tax documents (status <> 'draft') are legally immutable: they cannot be
-- hard-deleted (only reversed via a credit note) and their core financial /
-- identity content cannot be altered. The app already enforces this in TS, but a
-- direct DB write (bad code path, admin script, compromised key) would bypass it.
-- This BEFORE trigger closes that gap.
--
-- SCOPE / column decisions (derived from information_schema + a codebase audit of
-- every documents UPDATE/DELETE, 2026-07-05):
--
--   IMMUTABLE (blocked on change when OLD.status <> 'draft'):
--     number, type, date,
--     subtotal, vat, total, subtotal_ils, vat_ils, total_ils,
--     currency, exchange_rate, zero_rated, client_name
--
--   ALLOWED post-issue (never checked — real app flows mutate these):
--     status, paid_at, payment_reference          (status/payment flows)
--     allocation_number, allocation_set_at         (חשבונית ישראל allocation)
--     converted_to_id                              (quote->receipt convert)
--     emailed_at, email_opened_at, email_open_count (email send/open tracking)
--     approved_at, approval_signature              (quote approval)
--     client_tax_id                                (see note below)
--     notes, subject, payment_method               (editable metadata)
--
--   NOTES:
--   * client_tax_id is intentionally NOT immutable: DocumentCustomerTaxEditor lets
--     the user fill in the customer's ע.מ/ח.פ on an ALREADY-ISSUED tax invoice so
--     an allocation number can be requested (v2 mandates customer_vat_number).
--     Blocking it would break that flow.
--   * Spec columns that DO NOT EXIST on this table were dropped from the set:
--     updated_at, sent_at, converted_from_id, items (line items live in the
--     separate document_items table), vat_rate, client_address, client_email.
--     zero_rated (boolean) stands in for the tax-treatment flag vat_rate would be.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.enforce_document_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION
        'issued documents cannot be deleted (status=%); cancel via credit note',
        OLD.status;
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

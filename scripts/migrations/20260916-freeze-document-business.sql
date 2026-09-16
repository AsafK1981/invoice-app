-- An issued document can never move to another business.
--
-- Context: the coding council (2026-09-16) found that enforce_document_immutability froze
-- number, type, money, client and language on an issued document, but not business_id.
-- The documents UPDATE policy only checks that the NEW business belongs to the same user,
-- so an issued document could be re-pointed at another business of that user. Its number
-- came from the original business's counter, so the destination series would then hold a
-- used number that its own counter never saw - exactly the duplicate-number hazard the
-- counter triggers (20260916-raise-counters-after-document-insert.sql) exist to prevent,
-- and those triggers do not watch business_id.
--
-- Unreachable today: the unique index on businesses(user_id) (20260916-businesses-one-per-
-- user.sql) means no user has a second business to move a document to. This closes it
-- before any multi-business feature can reopen it. Moving a tax document between
-- businesses is also simply wrong on its own terms: it is part of the books of the
-- business that issued it.
--
-- REBUILT FROM THE LIVE pg_proc BODY, not from an earlier migration file. This function
-- has been replaced by several migrations in turn (20260906, 20260908, 20260916-document-
-- due-date), each CREATE OR REPLACE of the whole body, and rebuilding from a stale copy
-- would silently drop whichever guard came later. The only change here is the business_id
-- line. tests/document-client-isolation.mjs loads this file last and checks every guard.
--
-- No code updates documents.business_id (checked src/, scripts/, migrations): all matches
-- are WHERE filters. Account wipes DELETE; the businesses cascade DELETEs. Neither is an
-- UPDATE, so neither is affected.
--
-- Idempotent. Bounded locks like 20260908-documents-no-delete-once-numbered.sql.
-- Apply with: node scripts/run-sql-file.mjs --reason "..." scripts/migrations/20260916-freeze-document-business.sql

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.enforce_document_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status IS DISTINCT FROM 'draft'
       AND current_user <> 'service_role' THEN
      RAISE EXCEPTION
        'numbered documents cannot be deleted; mark it cancelled or issue a credit note';
    END IF;
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.status IS DISTINCT FROM 'draft' THEN
    IF NEW.status = 'draft' THEN RAISE EXCEPTION 'issued documents cannot be reverted to draft'; END IF;
    -- Added 2026-09-16: an issued document belongs to the business that issued it, forever.
    -- Its number was allocated from THAT business's counter; moving it would put a used
    -- number in another business's series without raising that series' counter. See
    -- 20260916-freeze-document-business.sql.
    IF NEW.business_id  IS DISTINCT FROM OLD.business_id  THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'business_id'; END IF;
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
    IF NEW.language     IS DISTINCT FROM OLD.language     THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'language'; END IF;
    -- Added 2026-09-16: the printed "לתשלום עד" date. See 20260916-document-due-date.sql.
    IF NEW.due_date     IS DISTINCT FROM OLD.due_date     THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'due_date'; END IF;
    -- Added 2026-09-08. NULL-ing client_id is the FK's ON DELETE SET NULL, see header.
    IF NEW.client_id IS DISTINCT FROM OLD.client_id AND NEW.client_id IS NOT NULL THEN
      RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'client_id';
    END IF;
    -- Added 2026-09-09, header item 3: 23א, a delivered VAT document is not cancelled.
    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
       AND current_user <> 'service_role'
       AND OLD.type IN ('tax_invoice', 'tax_invoice_receipt')
       AND (OLD.emailed_at IS NOT NULL OR OLD.original_issued_at IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.businesses b
                        WHERE b.id = OLD.business_id AND b.business_type = 'exempt') THEN
      RAISE EXCEPTION 'a delivered VAT document is reversed by a credit note, not by cancelling it (23a)';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;

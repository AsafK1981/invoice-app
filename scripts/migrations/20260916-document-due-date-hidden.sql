-- ============================================================================
-- "לתשלום עד" shown or hidden - frozen PER DOCUMENT at insert (2026-09-16).
--
-- The owner can hide the printed "לתשלום עד" line in the design settings
-- (businesses.document_design.showDueDate = false). That choice is a render
-- decision, and an issued document's printed content must never change: a
-- reprint is an "העתק" and has to match the original. So the choice in force
-- when the document is created is copied onto the document row and never
-- read from the business again for that document.
--
-- APPLY BEFORE DEPLOYING THE CODE THAT SHIPS WITH IT.
--   * /api/public-document selects due_date_hidden by name, so without the
--     column the public /view page (and the PDF, which prints that page)
--     returns 404 - exactly what due_date did in 20260916-document-due-date.sql.
--   * Nothing else in the app writes or needs the column; create_document_atomic
--     is NOT changed, the trigger below stamps every insert path.
--
--   node scripts/run-sql-file.mjs --reason "documents.due_date_hidden + insert stamp + immutability" scripts/migrations/20260916-document-due-date-hidden.sql
--
-- What this file does, in order:
--   1. documents.due_date_hidden boolean NOT NULL DEFAULT false + COMMENT.
--      Existing rows become false, which is exactly how they were issued: the
--      setting did not exist, so every one of them printed its due date.
--   2. BEFORE INSERT trigger trg_stamp_due_date_hidden -> stamp_due_date_hidden().
--      It ALWAYS overwrites NEW.due_date_hidden from the business's current
--      document_design, so a client can never choose the value itself. Only a
--      JSON boolean false hides the line; a missing key, a NULL design, a
--      string "false" or a non-object design all read as shown - the same
--      strict rule as normalizeDocumentDesign in src/lib/document-themes.ts.
--
--      INSERT ONLY, on purpose. A row inserted as 'draft' and issued later
--      keeps its insert-time value. The only paths that insert documents that
--      are not issued at once are the imports, and imports never set due_date,
--      so for them the flag prints nothing either way. No UPDATE trigger.
--
--      Who inserts documents, under which role, and whether the SELECT on
--      businesses inside this SECURITY INVOKER function sees the row:
--        * create_document_atomic (the editor, recurring page, proposal
--          cards): SECURITY DEFINER, owned by postgres (the table owner), so
--          the trigger body runs as that role and RLS does not filter it. The
--          function reads the very same businesses row itself a few lines
--          earlier (to check user_id = auth.uid()), so the stamp's read cannot
--          fail where the RPC succeeded. Row is read.
--        * create_document_for_bot (WhatsApp): SECURITY DEFINER, same. Row is
--          read. (It issues receipts and quotes only, which never print a due
--          date anyway.)
--        * csv-import-modal / bulk-import-zone: plain INSERT as authenticated
--          under RLS. The businesses SELECT policy "Users can view own
--          businesses" (user_id = auth.uid()) lets the owner read their own
--          business, and the documents INSERT policy only admits the owner's
--          own business_id. Row is read.
--        * /api/admin/import-for-user, src/lib/documents-server.ts
--          (subscription self-invoice), scripts/admin.mjs: service_role,
--          which bypasses RLS. Row is read.
--      NULL for the wrong reason: only when an authenticated caller inserts a
--      document for a business it does not own. The subquery then sees no row
--      and COALESCE gives false, but the documents INSERT policy's WITH CHECK
--      (evaluated after BEFORE triggers) rejects that row anyway, so no stored
--      document ever carries a value read that way. A business with no design
--      at all (document_design NULL) correctly reads false: nothing was hidden.
--
--   3. enforce_document_immutability freezes due_date_hidden once the
--      document left 'draft'. REBUILT FROM THE LIVE pg_proc BODY (saved on
--      2026-09-16 as live-immut-now.sql, which already contains the business_id
--      guard of 20260916-freeze-document-business.sql and the due_date guard of
--      20260916-document-due-date.sql), byte for byte, plus ONE guard line and
--      its one-line comment right after the due_date guard. Prove it, from the
--      repo root, with the saved live file at $LIVE:
--
--        diff <(tr -d '\r' < "$LIVE") \
--             <(tr -d '\r' < scripts/migrations/20260916-document-due-date-hidden.sql \
--                 | sed -n '/^CREATE OR REPLACE FUNCTION public.enforce_document_immutability()/,/^\$function\$;/p' \
--                 | sed 's/^\$function\$;$/$function$/')
--
--      Expected output: exactly the two added lines (the comment and the
--      due_date_hidden guard). pg_get_functiondef ends the body with
--      "$function$" and no semicolon; the migration needs the semicolon, which
--      the last sed puts back to the live form before comparing.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS. Bounded locks like 20260916-document-due-date.sql.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. Column ────────────────────────────────────────────────────────────────

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS due_date_hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.documents.due_date_hidden IS
  'נקבע פעם אחת בהכנסת המסמך, מתוך businesses.document_design.showDueDate של העסק באותו רגע (trigger trg_stamp_due_date_hidden). true = השורה "לתשלום עד" לא מודפסת על המסמך הזה, גם אם due_date מולא. false = מודפסת כשיש due_date. שורות קיימות הן false, בדיוק כפי שהופקו: ההגדרה לא הייתה קיימת. קפוא אחרי הפקה (enforce_document_immutability).';

-- ── 2. Stamp at insert ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.stamp_due_date_hidden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Always overwritten: the value comes from the business, never from the caller.
  NEW.due_date_hidden := COALESCE(
    (SELECT b.document_design -> 'showDueDate' = 'false'::jsonb
       FROM public.businesses b
      WHERE b.id = NEW.business_id),
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_due_date_hidden ON public.documents;

CREATE TRIGGER trg_stamp_due_date_hidden
  BEFORE INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_due_date_hidden();

-- Trigger firing does not need EXECUTE; nobody should call it directly.
REVOKE EXECUTE ON FUNCTION public.stamp_due_date_hidden() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.stamp_due_date_hidden() IS
  'BEFORE INSERT on documents: copies the business''s document_design.showDueDate (only a JSON false hides) onto documents.due_date_hidden, overwriting whatever the caller sent. Insert only; see scripts/migrations/20260916-document-due-date-hidden.sql';

-- ── 3. Immutability: due_date_hidden is frozen once the document is issued ──
--
-- Same wiring as 20260916-document-due-date.sql.

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
    -- Added 2026-09-16: whether that line is printed. See 20260916-document-due-date-hidden.sql.
    IF NEW.due_date_hidden IS DISTINCT FROM OLD.due_date_hidden THEN RAISE EXCEPTION 'issued documents are immutable: field % cannot be changed', 'due_date_hidden'; END IF;
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

DROP TRIGGER IF EXISTS trg_enforce_document_immutability ON public.documents;

CREATE TRIGGER trg_enforce_document_immutability
  BEFORE UPDATE OR DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_document_immutability();

REVOKE EXECUTE ON FUNCTION public.enforce_document_immutability() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_document_immutability() IS
  'DB-level guard: a document that left status=draft can never be deleted (only an account wipe running as service_role may), and its business/money/identity/due-date columns, including whether the due date is printed, are frozen. See scripts/migrations/20260908-documents-no-delete-once-numbered.sql, 20260916-document-due-date.sql, 20260916-freeze-document-business.sql and 20260916-document-due-date-hidden.sql';

NOTIFY pgrst, 'reload schema';

COMMIT;

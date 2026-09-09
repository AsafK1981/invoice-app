-- ============================================================================
-- קובץ קבוע: a document that received a number can never be deleted (2026-09-08)
--
-- הוראות מס הכנסה (ניהול פנקסי חשבונות), הגדרת "קובץ קבוע": "קובץ אשר
-- מתקיימים בו כל אלה: 1. אין אפשרות למחוק בו רשומה; 2. הרשומות בו מוספרו
-- באופן אוטומטי במספור עוקב", and סעיף 23(ב): a record "אין לשנות או לתקן
-- אלא באמצעות תיעוד נוסף". Reversing an issued document is therefore a
-- credit note (חשבונית זיכוי), never a delete.
--
-- ----------------------------------------------------------------------------
-- READ THIS BEFORE YOU REDEFINE THIS FUNCTION AGAIN
-- ----------------------------------------------------------------------------
-- public.enforce_document_immutability() has now been redefined SEVEN times in
-- scripts/migrations. In date order, every file that issues a
-- CREATE OR REPLACE FUNCTION public.enforce_document_immutability():
--
--   1. 20260705-documents-immutability-trigger.sql
--   2. 20260706-documents-immutability-rounding.sql
--   3. 20260707-documents-deletable-when-unsent.sql
--   4. 20260803-documents-immutability-withholding-discount.sql
--   5. 20260807-documents-immutability-no-draft-revert.sql
--   6. 20260906-documents-language.sql        <- the predecessor of THIS file
--   7. 20260908-documents-no-delete-once-numbered.sql  (this file)
--
-- Because the statement is CREATE OR REPLACE, whatever body the newest applied
-- file carries becomes the WHOLE function: any guard it fails to repeat is
-- silently deleted from production. So the rule is absolute:
--
--   REBUILD FROM THE NEWEST FILE IN THAT LIST, NEVER FROM THE ONE THE DESIGN
--   DOC HAPPENS TO NAME, AND DIFF YOUR BODY AGAINST IT BEFORE COMMITTING.
--
-- This file learned that the hard way. Its first draft was built on 20260807
-- (item 5) and called it "the previous CANONICAL definition". It was not:
-- 20260906 (item 6) is newer and had already added a 19th field guard,
-- `language`. Rebuilding from 20260807 would have shipped a migration that
-- silently dropped the language guard, letting an issued English invoice be
-- flipped to Hebrew after the customer already held a copy of it. The same
-- trap caught 20260906 itself, whose design doc had named 20260707 (item 3).
--
-- BASE USED HERE: 20260906-documents-language.sql, verbatim. The UPDATE branch
-- below reproduces its `IF OLD.status IS DISTINCT FROM 'draft' THEN` opener,
-- its no-revert-to-draft guard, and all 19 of its field guards
-- (number, type, date, subtotal, vat, total, rounding, round_total,
-- subtotal_ils, vat_ils, total_ils, currency, exchange_rate, zero_rated,
-- client_name, withholding_rate, withholding_amount, discount_amount,
-- language) byte for byte. Prove it, from the repo root:
--
--   diff <(sed -n '238,258p' scripts/migrations/20260906-documents-language.sql) \
--        <(sed -n "/^  -- TG_OP = 'UPDATE'/,/^    -- Added 2026-09-08/p" \
--            scripts/migrations/20260908-documents-no-delete-once-numbered.sql \
--          | sed '1d;$d')
--
-- ----------------------------------------------------------------------------
-- What changes vs 20260906-documents-language.sql
-- ----------------------------------------------------------------------------
--
--   1. DELETE branch. Was keyed on OLD.emailed_at IS NOT NULL, i.e. an
--      issued-but-never-emailed document could still be deleted - which tore
--      a hole in a numbering sequence the law requires to be unbroken (and is
--      exactly what the "בדיקת רצף מספור" report now reports on). The gate is
--      now OLD.status: only a draft may go. A draft is a קובץ זמני in the
--      law's terms, but NOTE (council, 2026-09-09): in this schema a draft DOES
--      consume a running number (create_document_atomic advances the counter
--      regardless of p_status), so deleting a draft still leaves a gap, which
--      /reports/sequence will list. Allocating the number only on issue is a
--      separate follow-up; this migration narrows the deletable set, it does
--      not make the sequence gap-free.
--      Reversing an issued document is a STATUS change (to 'cancelled') or a
--      credit note. The UPDATE branch guards `status` in exactly two ways:
--      never back to 'draft', and (item 3) never to 'cancelled' on a delivered
--      VAT document.
--
--   3. UPDATE branch, הוראות ניהול ספרים 23א (added 2026-09-09 after the
--      council found the rule enforced only in browser code): a VAT-bearing
--      document (tax_invoice / tax_invoice_receipt) whose original has already
--      left the business (emailed_at or original_issued_at set) may not be set
--      to 'cancelled' by an ordinary user, because vat-period-report.tsx and
--      ita/pcn874.ts drop cancelled rows and that would silently un-report VAT
--      the customer may have deducted. The route for those is a credit note.
--      Fails closed: only a business that is provably 'exempt' (no VAT to
--      reverse) is let through; service_role is exempt for support tooling.
--      The same rule, same facts, as src/lib/document-cancel.ts.
--
--   2. UPDATE branch, ONE column added to the 19 already guarded:
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
--
-- ----------------------------------------------------------------------------
-- NOT frozen: allocation_number (מספר הקצאה). Deliberate - do not "fix" this.
-- ----------------------------------------------------------------------------
-- An earlier draft of this file froze allocation_number once set. That guard
-- was removed before the migration was ever applied, because it would have
-- broken two LIVE UI paths in src/components/allocation-number-section.tsx:
--   * handleSave (~line 124) calls setAllocationNumber(doc.id, trimmed) for a
--     REPLACEMENT number, not only for the first one - the component even
--     branches on `isFirstNumber` to tell the two cases apart.
--   * handleClear (~line 152) calls setAllocationNumber(doc.id, null), behind
--     an explicit "the customer already has this number" confirmation dialog.
-- The allocation number is not a property of our books: it is a reference
-- returned by רשות המסים for a document, and it is legitimately corrected and
-- reissued (a rejected or superseded allocation is re-requested and the new
-- number replaces the old one). Freezing it would only mean the app could
-- never record the correction, while the document itself - number, date, money,
-- parties - stays exactly as immutable as before. Every change to it is
-- already captured in the audit trail, which is what the books need.
-- The UI is correct as it stands and was NOT changed for this migration.
--
-- ----------------------------------------------------------------------------
-- The account-wipe carve-out: service_role ONLY, deliberately not postgres
-- ----------------------------------------------------------------------------
-- /api/delete-account and /api/danger/delete-all wipe a user's data on their
-- own explicit request, using SUPABASE_SERVICE_ROLE_KEY. PostgREST SETs ROLE
-- service_role for those calls, so current_user = 'service_role' inside this
-- trigger and they are let through. Under the previous rule they got through
-- by nulling emailed_at first; status cannot be nulled the same way, since an
-- issued document may never be reverted to draft, so the exemption has to be
-- explicit.
--
-- An earlier draft also exempted 'postgres'. This one does not, on purpose:
--   * A foreign-key referential action (ON DELETE CASCADE / ON DELETE SET NULL)
--     does not run as the user who issued the statement. It runs as the OWNER
--     of the referencing table, which here is postgres. Exempting postgres
--     would therefore hand a bypass to every present and future cascade that
--     reaches public.documents: the rule would hold for a direct DELETE and
--     quietly not hold for a cascade, which is the far harder case to notice.
--   * Nothing legitimate needs it today. An authenticated user cannot delete a
--     businesses row at all - there is no DELETE policy on public.businesses
--     (see 20260816-core-rls-policies-snapshot.sql:16, "no DELETE policy:
--     account wipes go through the service role on purpose"), so no user-driven
--     cascade can reach documents. Both wipe routes delete from documents
--     EXPLICITLY, under service_role. And no migration deletes a numbered
--     document: 20260802-reclassify-legacy-proforma.sql, the one migration that
--     needs this trigger out of the way, uses ALTER TABLE ... DISABLE TRIGGER
--     inside its own transaction, which stays available to whoever owns the
--     table.
--
-- CONSEQUENCE, STATED PLAINLY: deleting a user from the Supabase dashboard
-- (that connection runs as supabase_auth_admin, not service_role) while that
-- user still owns numbered documents will now RAISE
-- "numbered documents cannot be deleted; mark it cancelled or issue a credit
-- note", and the deletion will fail. That is intended, not a bug. Delete
-- such an account through /api/delete-account instead: it wipes the data as service_role first
-- and removes the auth user last.
--
-- The emailed_at nulling in those two routes is now redundant - the
-- service_role exemption is what lets them through. It was deliberately left
-- in place (a comment marks it in each route) so the wipes keep working
-- against a database that has not had this migration applied yet.
--
-- ONE trigger, not two: trg_enforce_document_immutability is already
-- BEFORE UPDATE OR DELETE on public.documents, so both branches live in this
-- one function. Adding a separate BEFORE DELETE trigger would only make two
-- guards fire for the same row.
--
-- Wrapped in an explicit transaction with bounded locks, like its sibling
-- 20260908-document-client-isolation.sql. The DROP/CREATE TRIGGER pair takes
-- ACCESS EXCLUSIVE on public.documents, and a 5s lock_timeout makes this
-- migration fail fast on a busy table instead of queueing behind every reader
-- and blocking them. That block is retained (CREATE OR REPLACE FUNCTION on its
-- own already re-points the existing trigger at the new body, so it is not
-- strictly needed) only because it is BYTE-IDENTICAL to the wiring in
-- 20260906-documents-language.sql lines 265-270, so re-running it cannot
-- change the trigger definition.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- Apply with: node scripts/run-sql-file.mjs scripts/migrations/20260908-documents-no-delete-once-numbered.sql
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.enforce_document_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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

COMMIT;

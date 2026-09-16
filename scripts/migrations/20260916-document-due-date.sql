-- ============================================================================
-- "לתשלום עד" - a due date stated on the document (2026-09-16).
--
-- A tax invoice or a pro forma can now say when payment is due. Printing that
-- date is ALLOWED and OPTIONAL: it is not one of the mandatory particulars of
-- סעיף 9(א) להוראות ניהול פנקסי חשבונות or תקנה 9א(א) לתקנות מע"מ, and neither
-- forbids it. So the column is an information field only. NULL - the default,
-- and every existing row - means "no due date stated" and prints nothing.
-- Nothing is backfilled: a date the owner never chose must not appear on a
-- document the customer already holds.
--
-- APPLY BEFORE DEPLOYING THE CODE THAT SHIPS WITH IT.
--   * /api/public-document selects due_date by name, so without the column the
--     public /view page (and the PDF, which prints that page) returns 404.
--   * The editor sends p_due_date to create_document_atomic only when a due
--     date is set. A document WITHOUT one never sends it, so that path keeps
--     working either way; one WITH a due date needs the 33-arg function below.
--
--   node scripts/run-sql-file.mjs --reason "document due date column + RPC + immutability + eom_45" scripts/migrations/20260916-document-due-date.sql
--
-- What this file does, in order:
--   1. documents.due_date (date, NULL) + COMMENT + two CHECKs: only
--      tax_invoice / proforma may carry one (DUE_DATE_DOCUMENT_TYPES in
--      src/lib/types.ts), and it is never before the document date. Every
--      existing row is NULL, so both CHECKs validate trivially.
--   2. create_document_atomic gains ONE trailing param, p_due_date date
--      DEFAULT NULL, written straight into the INSERT. Built from the newest
--      definition, 20260915-atomic-convert-and-cancel.sql, byte for byte
--      otherwise. due_date is written once, at insert. The app has no path
--      that UPDATEs it (editor drafts live in the drafts table as JSON, not as
--      documents rows), and step 3 makes sure none can after issue.
--   3. enforce_document_immutability freezes due_date once the document left
--      'draft', like language and currency: the customer holds a copy with that
--      date printed on it. Built from the newest definition,
--      20260908-documents-no-delete-once-numbered.sql (item 7 in the list in
--      that file's header; THIS file is item 8), byte for byte, plus ONE guard
--      line and its comment. Prove it, from the repo root:
--
--        diff <(sed -n '/^CREATE OR REPLACE FUNCTION public.enforce_document_immutability()/,/^\$\$;/p' \
--                 scripts/migrations/20260908-documents-no-delete-once-numbered.sql) \
--             <(sed -n '/^CREATE OR REPLACE FUNCTION public.enforce_document_immutability()/,/^\$\$;/p' \
--                 scripts/migrations/20260916-document-due-date.sql)
--
--   4. clients.payment_terms gains 'eom_45' (שוטף + 45, the statutory default
--      of חוק מוסר תשלומים לספקים, סעיף 3(ז)). That column shipped today in
--      20260916-client-payment-terms.sql with a nine-value CHECK, so the CHECK
--      is DROPPED and re-added with ten values. Every stored value is in the
--      new list, so the re-add validates.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, guarded / dropped constraints,
-- DROP FUNCTION IF EXISTS + CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. Column ────────────────────────────────────────────────────────────────

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS due_date date;

COMMENT ON COLUMN public.documents.due_date IS
  'לתשלום עד: מועד התשלום שצוין על המסמך. שדה מידע רשות בלבד, לא פרט חובה לפי סעיף 9(א) להוראות ניהול פנקסי חשבונות או תקנה 9א(א) לתקנות מע"מ. רק ל-tax_invoice ול-proforma. NULL = לא צוין מועד, ולא מודפס דבר.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.documents'::regclass
      AND conname = 'documents_due_date_type_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_due_date_type_check
      CHECK (due_date IS NULL OR type IN ('tax_invoice', 'proforma'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.documents'::regclass
      AND conname = 'documents_due_date_not_before_date_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_due_date_not_before_date_check
      CHECK (due_date IS NULL OR due_date >= date);
  END IF;
END;
$$;

-- ── 2. RPC: create_document_atomic takes p_due_date ──────────────────────────
--
-- New arg list => NEW overload. DROP the 32-arg overload (20260915) AND the
-- 31-arg one (20260906, in case 20260915 was never applied to this database),
-- so exactly ONE function remains: two overloads would make a named-arg call
-- ambiguous. Grants re-asserted for the 33-arg signature: authenticated +
-- service_role only, never PUBLIC/anon.

DROP FUNCTION IF EXISTS public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text
);

DROP FUNCTION IF EXISTS public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text, uuid
);

CREATE OR REPLACE FUNCTION public.create_document_atomic(
  p_business_id uuid, p_id uuid, p_type text, p_date date, p_client_id uuid,
  p_client_name text, p_subject text, p_status text, p_subtotal numeric,
  p_vat numeric, p_total numeric, p_payment_method text, p_notes text,
  p_items jsonb, p_currency text DEFAULT 'ILS'::text,
  p_exchange_rate numeric DEFAULT 1, p_subtotal_ils numeric DEFAULT NULL::numeric,
  p_vat_ils numeric DEFAULT NULL::numeric, p_total_ils numeric DEFAULT NULL::numeric,
  p_zero_rated boolean DEFAULT false, p_client_tax_id text DEFAULT NULL::text,
  p_number integer DEFAULT NULL::integer,
  p_original_document_id uuid DEFAULT NULL::uuid,
  p_rounding numeric DEFAULT 0,
  p_round_total boolean DEFAULT false,
  p_withholding_rate numeric DEFAULT NULL::numeric,
  p_withholding_amount numeric DEFAULT NULL::numeric,
  p_discount_amount numeric DEFAULT NULL::numeric,
  p_payment_details jsonb DEFAULT NULL::jsonb,
  p_payment_reference text DEFAULT NULL::text,
  p_language text DEFAULT 'he'::text,
  p_source_document_id uuid DEFAULT NULL::uuid,
  p_due_date date DEFAULT NULL::date
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_number int;
  v_business_user uuid;
  v_business_type text;
  v_item_sum numeric;
  v_tol constant numeric := 0.01;
  v_src_type text;
  v_src_status text;
  v_src_converted_to uuid;
BEGIN
  SELECT user_id, business_type INTO v_business_user, v_business_type
  FROM businesses WHERE id = p_business_id;
  IF v_business_user IS NULL OR auth.uid() IS NULL OR v_business_user IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Defense-in-depth: reject internally inconsistent money the client supplied.
  -- Rounding (הפרש עיגול) absorbs the whole-shekel adjustment, so the invariant
  -- is total = subtotal + vat + rounding (rounding is 0 when the feature is off).
  -- The stored subtotal is already post-discount, so the discount does not enter
  -- this check.
  IF ABS(COALESCE(p_total, 0) - (COALESCE(p_subtotal, 0) + COALESCE(p_vat, 0) + COALESCE(p_rounding, 0))) > v_tol THEN
    RAISE EXCEPTION 'inconsistent totals: total (%) <> subtotal (%) + vat (%) + rounding (%)',
      p_total, p_subtotal, p_vat, p_rounding;
  END IF;

  -- Line items persist their FULL (pre-discount) amounts; the document-level
  -- discount is subtracted here so a discounted subtotal reconciles.
  SELECT COALESCE(SUM((item->>'total')::numeric), 0) INTO v_item_sum
  FROM jsonb_array_elements(p_items) AS item;
  IF ABS((v_item_sum - COALESCE(p_discount_amount, 0)) - COALESCE(p_subtotal, 0)) > v_tol THEN
    RAISE EXCEPTION 'item totals (%) minus discount (%) do not sum to subtotal (%)',
      v_item_sum, COALESCE(p_discount_amount, 0), p_subtotal;
  END IF;

  IF v_business_type = 'exempt' AND ABS(COALESCE(p_vat, 0)) > v_tol THEN
    RAISE EXCEPTION 'exempt business (עוסק פטור) cannot charge VAT (got %)', p_vat;
  END IF;

  -- Convert: lock the source for the rest of this transaction. A concurrent
  -- convert of the same source blocks on this row until we commit, then reads
  -- the committed converted_to_id and raises below. The business filter is in
  -- the WHERE so a foreign row is never locked, and "not yours" reads exactly
  -- like "does not exist". The raise order matches conversionBlock() in
  -- src/lib/document-prefill.ts; the client maps these messages to Hebrew.
  IF p_source_document_id IS NOT NULL THEN
    IF p_source_document_id = p_id THEN
      RAISE EXCEPTION 'convert_source_not_found';
    END IF;

    SELECT type, status, converted_to_id
      INTO v_src_type, v_src_status, v_src_converted_to
    FROM documents
    WHERE id = p_source_document_id AND business_id = p_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'convert_source_not_found';
    END IF;
    IF v_src_converted_to IS NOT NULL THEN
      RAISE EXCEPTION 'convert_source_already_converted'
        USING HINT = v_src_converted_to::text;
    END IF;
    IF v_src_status = 'cancelled' THEN
      RAISE EXCEPTION 'convert_source_cancelled';
    END IF;
    IF v_src_status IS NULL OR v_src_status = 'draft' THEN
      RAISE EXCEPTION 'convert_source_draft';
    END IF;
    -- The only pairs the app offers: quote/proforma -> receipt or tax invoice
    -- receipt, tax invoice -> receipt (its VAT was already invoiced).
    IF v_src_type NOT IN ('quote', 'proforma', 'tax_invoice')
       OR p_type NOT IN ('receipt', 'tax_invoice_receipt')
       OR (v_src_type = 'tax_invoice' AND p_type <> 'receipt') THEN
      RAISE EXCEPTION 'convert_type_not_allowed';
    END IF;
  END IF;

  IF p_number IS NULL THEN
    -- Auto-allocate from the counter (default behavior).
    INSERT INTO document_counters (business_id, doc_type, next_number)
    VALUES (p_business_id, p_type, CASE WHEN p_type = 'receipt' THEN 1001 ELSE 201 END)
    ON CONFLICT (business_id, doc_type) DO NOTHING;

    UPDATE document_counters
    SET next_number = next_number + 1
    WHERE business_id = p_business_id AND doc_type = p_type
    RETURNING next_number - 1 INTO v_number;
  ELSE
    -- User chose an explicit number. Use it, and keep the counter ahead so
    -- future auto-numbers don't collide (GREATEST handles backfilled gaps).
    v_number := p_number;
    INSERT INTO document_counters (business_id, doc_type, next_number)
    VALUES (p_business_id, p_type, p_number + 1)
    ON CONFLICT (business_id, doc_type) DO UPDATE
      SET next_number = GREATEST(document_counters.next_number, p_number + 1);
  END IF;

  INSERT INTO documents (
    id, business_id, type, number, date, client_id, client_name,
    subject, status, subtotal, vat, total, payment_method, notes,
    currency, exchange_rate, subtotal_ils, vat_ils, total_ils, zero_rated,
    client_tax_id, original_document_id, rounding, round_total,
    withholding_rate, withholding_amount, discount_amount, payment_details,
    payment_reference, language, due_date
  ) VALUES (
    p_id, p_business_id, p_type, v_number, p_date, p_client_id, p_client_name,
    p_subject, p_status, p_subtotal, p_vat, p_total, p_payment_method, p_notes,
    COALESCE(p_currency, 'ILS'), COALESCE(p_exchange_rate, 1),
    COALESCE(p_subtotal_ils, p_subtotal), COALESCE(p_vat_ils, p_vat),
    COALESCE(p_total_ils, p_total), COALESCE(p_zero_rated, false),
    NULLIF(p_client_tax_id, ''), p_original_document_id,
    COALESCE(p_rounding, 0), COALESCE(p_round_total, false),
    p_withholding_rate, p_withholding_amount, p_discount_amount, p_payment_details,
    NULLIF(p_payment_reference, ''), COALESCE(NULLIF(p_language, ''), 'he'),
    p_due_date
  );

  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO document_items (id, document_id, product_id, description, quantity, unit_price, total, sort_order)
    SELECT (item->>'id')::uuid, p_id, NULLIF(item->>'product_id', '')::uuid,
      item->>'description', (item->>'quantity')::numeric, (item->>'unit_price')::numeric,
      (item->>'total')::numeric, (idx - 1)::int
    FROM jsonb_array_elements(p_items) WITH ORDINALITY arr(item, idx);
  END IF;

  -- Link the source in the same transaction. status, paid_at and
  -- converted_to_id are not guarded by enforce_document_immutability (only a
  -- revert to draft and a 23a cancel are), so this passes on an issued source.
  -- The converted_to_id IS NULL guard cannot fail while we hold the row lock;
  -- it stays as a second line of defense.
  IF p_source_document_id IS NOT NULL THEN
    UPDATE documents
    SET converted_to_id = p_id, status = 'paid', paid_at = now()
    WHERE id = p_source_document_id
      AND business_id = p_business_id
      AND converted_to_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'convert_source_already_converted';
    END IF;
  END IF;

  RETURN json_build_object('id', p_id, 'number', v_number);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text, uuid, date
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text, uuid, date
) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text, uuid, date
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text, uuid, date
) TO service_role;

-- ── 3. Immutability: due_date is frozen once the document is issued ─────────
--
-- Same wiring as 20260908 (see the header there for why service_role, and only
-- service_role, is exempt from the DELETE rule).

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
$$;

DROP TRIGGER IF EXISTS trg_enforce_document_immutability ON public.documents;

CREATE TRIGGER trg_enforce_document_immutability
  BEFORE UPDATE OR DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_document_immutability();

REVOKE EXECUTE ON FUNCTION public.enforce_document_immutability() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_document_immutability() IS
  'DB-level guard: a document that left status=draft can never be deleted (only an account wipe running as service_role may), and its money/identity/due-date columns are frozen. See scripts/migrations/20260908-documents-no-delete-once-numbered.sql and 20260916-document-due-date.sql';

-- ── 4. clients.payment_terms: add eom_45 (שוטף + 45) ─────────────────────────
-- The same ten codes as PaymentTerms in src/lib/payment-terms.ts.

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_payment_terms_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_payment_terms_check
  CHECK (
    payment_terms IS NULL
    OR payment_terms IN (
      'immediate',
      'net_15', 'net_30', 'net_45', 'net_60',
      'eom', 'eom_30', 'eom_45', 'eom_60', 'eom_90'
    )
  );

COMMENT ON COLUMN public.clients.payment_terms IS
  'תנאי התשלום שסוכמו עם הלקוח. immediate = מיידי; net_N = N ימים מתאריך החשבונית; eom = שוטף (סוף חודש החשבונית); eom_N = שוטף + N (30/45/60/90). NULL = לא סוכמו תנאים, ותחזית התזרים אומדת לפי חציון ימי התשלום בפועל.';

NOTIFY pgrst, 'reload schema';

COMMIT;

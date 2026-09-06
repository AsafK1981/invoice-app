-- ============================================================================
-- English documents (2026-09-06): a document is issued in Hebrew or in English.
--
-- Freelancers with foreign clients need the SAME document (quote, pro forma,
-- tax invoice, receipt, tax invoice/receipt, credit note) rendered in English.
-- Multi-currency already exists; only the language was missing. The language is
-- a property of the document, not of the business or the client, so it is
-- snapshotted on the row and frozen once the document leaves 'draft' - exactly
-- like currency and exchange_rate, and for the same reason: the customer holds
-- a copy of what was issued, and it must never change under them.
--
-- APPLY BEFORE DEPLOYING. Code shipped without this migration would send
-- p_language to an RPC overload that does not accept it (PostgREST 404
-- "function not found") and every document save would fail.
--
--   node scripts/run-sql-file.mjs --reason "English documents: language column + RPC + immutability guard" scripts/migrations/20260906-documents-language.sql
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded CHECK + CREATE OR REPLACE
-- FUNCTION + DROP TRIGGER IF EXISTS.
-- ============================================================================

-- ── 1. Column ────────────────────────────────────────────────────────────────
-- NOT NULL DEFAULT 'he': every existing row is Hebrew, which is what they were
-- actually issued as. Undefined/absent in app code reads as 'he' too.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'he';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.documents'::regclass
      AND conname = 'documents_language_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_language_check CHECK (language IN ('he', 'en'));
  END IF;
END;
$$;

-- ── 2. RPC: extend create_document_atomic ────────────────────────────────────
--
-- Built from the CURRENT LIVE definition - the 31-arg overload ending in
-- (p_payment_details, p_payment_reference) from
-- 20260719-withholding-discount-payment-details.sql, which is the newest
-- migration that defines this function. The ONLY changes:
--   * one new trailing param, DEFAULTed so every named-param caller keeps
--     working unchanged:  p_language text DEFAULT 'he'
--   * `language` added to the documents INSERT, COALESCEd to 'he' so an
--     explicit NULL from a caller cannot violate the NOT NULL column.
-- Auth guard, money invariants, exempt vat=0 check, item-sum check, counter
-- logic, SECURITY DEFINER, SET search_path, and the items insert are otherwise
-- byte-for-byte identical.
--
-- New arg list => NEW overload; DROP the prior 31-arg overload first so exactly
-- ONE function remains (a bare call would otherwise be ambiguous). Grants are
-- re-asserted for the new 32-arg signature (authenticated + service_role only,
-- never PUBLIC/anon).

DROP FUNCTION IF EXISTS public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text
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
  p_language text DEFAULT 'he'::text
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
    payment_reference, language
  ) VALUES (
    p_id, p_business_id, p_type, v_number, p_date, p_client_id, p_client_name,
    p_subject, p_status, p_subtotal, p_vat, p_total, p_payment_method, p_notes,
    COALESCE(p_currency, 'ILS'), COALESCE(p_exchange_rate, 1),
    COALESCE(p_subtotal_ils, p_subtotal), COALESCE(p_vat_ils, p_vat),
    COALESCE(p_total_ils, p_total), COALESCE(p_zero_rated, false),
    NULLIF(p_client_tax_id, ''), p_original_document_id,
    COALESCE(p_rounding, 0), COALESCE(p_round_total, false),
    p_withholding_rate, p_withholding_amount, p_discount_amount, p_payment_details,
    NULLIF(p_payment_reference, ''), COALESCE(NULLIF(p_language, ''), 'he')
  );

  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO document_items (id, document_id, product_id, description, quantity, unit_price, total, sort_order)
    SELECT (item->>'id')::uuid, p_id, NULLIF(item->>'product_id', '')::uuid,
      item->>'description', (item->>'quantity')::numeric, (item->>'unit_price')::numeric,
      (item->>'total')::numeric, (idx - 1)::int
    FROM jsonb_array_elements(p_items) WITH ORDINALITY arr(item, idx);
  END IF;

  RETURN json_build_object('id', p_id, 'number', v_number);
END;
$function$;

-- Re-assert intended grants for the NEW 32-arg signature (authenticated +
-- service_role only; no PUBLIC/anon).
REVOKE EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text
) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text
) TO service_role;

-- ── 3. Immutability: language is frozen once the document is issued ──────────
--
-- The customer holds a copy of the document in the language it was issued in.
-- Flipping the language afterwards would change the words on a tax document
-- that has already been delivered, so it joins the frozen set.
--
-- BASE USED HERE: 20260807-documents-immutability-no-draft-revert.sql, the
-- NEWEST definition and the one matching live prosrc - the DELETE branch keyed
-- on OLD.emailed_at IS NOT NULL, the no-revert-to-draft guard, and all 18
-- field guards, copied byte-for-byte. The ONLY change is one new guard line for
-- `language`.
--
-- (The design doc named 20260707-documents-deletable-when-unsent.sql as the
-- canonical base; that file's own header says it is the historical 15-guard
-- version and that 20260803 -> 20260807 supersede it. Rebuilding from 20260707
-- would have silently reverted the withholding/discount guards AND the
-- status-flip fix. Do NOT rebuild this function from 20260705/20260706/20260707.)
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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_document_immutability ON public.documents;

CREATE TRIGGER trg_enforce_document_immutability
  BEFORE UPDATE OR DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_document_immutability();

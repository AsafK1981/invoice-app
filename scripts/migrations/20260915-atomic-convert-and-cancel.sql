-- ============================================================================
-- Atomic convert and atomic cancel (2026-09-15).
--
-- APPLY BEFORE DEPLOYING THE CODE THAT SHIPS WITH IT. The editor now sends
-- p_source_document_id to create_document_atomic and the cancel buttons call
-- cancel_document_atomic. Code deployed without this migration gets PostgREST
-- "function not found" on every convert and every cancel. The reverse order is
-- safe: the new 33-arg create_document_atomic still accepts every call the old
-- code makes (the new param defaults to NULL), and cancel_document_atomic is
-- only additive.
--
--   node scripts/run-sql-file.mjs --reason "atomic convert + cancel RPCs" scripts/migrations/20260915-atomic-convert-and-cancel.sql
--
-- Why:
--   1. Convert was check-then-act from the browser: the editor re-read the
--      source, called create_document_atomic, and only then marked the source
--      converted. Two tabs issuing in the same instant both passed the check
--      and issued two paid receipts for one payment. Now the source row is
--      locked (SELECT ... FOR UPDATE) inside the same transaction that creates
--      the document and links the source, so the second call waits for the
--      first to commit, re-reads the row, sees converted_to_id and raises
--      convert_source_already_converted. Nothing of the second call persists
--      (not even a consumed running number).
--   2. cancelDocument wrote status 'cancelled' and released the conversion
--      source in two separate requests. A failure in between left the source
--      paid + converted forever. cancel_document_atomic does both in one
--      transaction, and running it again on an already-cancelled document
--      re-runs only the release, so a document cancelled by the old two-step
--      code can be repaired from the UI.
--
-- Idempotent: DROP FUNCTION IF EXISTS on the old overload + CREATE OR REPLACE.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. create_document_atomic: optional conversion source ────────────────────
--
-- Built from the newest definition, 20260906-documents-language.sql (32 args,
-- ending in p_language). The ONLY changes:
--   * one new trailing param  p_source_document_id uuid DEFAULT NULL
--   * a source block after the money checks and before the counter: lock the
--     source row of the SAME business, refuse if already converted, cancelled,
--     draft, or not a convertible type pair
--   * after the items insert: link the source (converted_to_id, status paid,
--     paid_at now()), exactly what linkConvertedDocument did from the browser
-- Auth guard, money invariants, exempt vat=0 check, item-sum check, counter
-- logic, SECURITY DEFINER, SET search_path, the documents and items inserts
-- are otherwise byte-for-byte identical. document-store.ts is the only caller.
--
-- New arg list => NEW overload; DROP the 32-arg overload first so exactly ONE
-- function remains. Grants are re-asserted for the new 33-arg signature exactly
-- as before: authenticated + service_role only, never PUBLIC/anon.

DROP FUNCTION IF EXISTS public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text
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
  p_source_document_id uuid DEFAULT NULL::uuid
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
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text, uuid
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text, uuid
) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean, numeric, numeric, numeric, jsonb, text, text, uuid
) TO service_role;

-- ── 2. cancel_document_atomic: cancel + release conversion sources ───────────
--
-- SECURITY INVOKER on purpose: it does nothing the signed-in owner cannot
-- already do with two direct UPDATEs through PostgREST, so it runs under the
-- caller's RLS (documents: business_id IN the caller's businesses) and under
-- enforce_document_immutability exactly as those UPDATEs did, including the
-- 23a rule that a delivered VAT document is reversed by a credit note. If that
-- trigger raises, the whole call rolls back and no source is released.
--
-- The 23a(1) route decision (cancellationRoute) and the audit entries stay in
-- src/lib/document-store.ts; the function returns what it released so the
-- client can audit each source.
--
-- On an already-cancelled document the status write is skipped and only the
-- release runs, so it is safe to call again and repairs documents cancelled by
-- the old two-request code whose source was never released.

CREATE OR REPLACE FUNCTION public.cancel_document_atomic(p_document_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_business_id uuid;
  v_status text;
  v_released json;
BEGIN
  SELECT business_id, status INTO v_business_id, v_status
  FROM documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_document_not_found';
  END IF;
  IF v_status IS NULL OR v_status = 'draft' THEN
    RAISE EXCEPTION 'cancel_document_is_draft';
  END IF;

  IF v_status IS DISTINCT FROM 'cancelled' THEN
    UPDATE documents
    SET status = 'cancelled', paid_at = NULL
    WHERE id = p_document_id;
  END IF;

  -- Sources converted into this document go back to open ("sent"); a source
  -- that is itself cancelled stays cancelled. The locking CTE reads the
  -- pre-update status for the audit trail.
  WITH src AS (
    SELECT id, type, number, client_name, client_id, status
    FROM documents
    WHERE converted_to_id = p_document_id
      AND business_id = v_business_id
    ORDER BY id
    FOR UPDATE
  ), released AS (
    UPDATE documents d
    SET converted_to_id = NULL,
        status = CASE WHEN src.status = 'cancelled' THEN 'cancelled' ELSE 'sent' END,
        paid_at = NULL
    FROM src
    WHERE d.id = src.id
    RETURNING d.id, src.type, src.number, src.client_name, src.client_id,
              src.status AS from_status, d.status AS to_status
  )
  SELECT COALESCE(json_agg(json_build_object(
           'id', id, 'type', type, 'number', number,
           'client_name', client_name, 'client_id', client_id,
           'from_status', from_status, 'to_status', to_status)), '[]'::json)
    INTO v_released
  FROM released;

  RETURN json_build_object(
    'already_cancelled', v_status = 'cancelled',
    'released', v_released
  );
END;
$function$;

-- Callable by signed-in owners (RLS scopes it) and the service role, like
-- create_document_atomic. Never PUBLIC/anon.
REVOKE EXECUTE ON FUNCTION public.cancel_document_atomic(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_document_atomic(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_document_atomic(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_document_atomic(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

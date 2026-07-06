-- Add optional final-total rounding (הפרש עיגול) to the atomic doc-creation RPC.
--
-- Built from the CURRENT LIVE definition (pg_get_functiondef, 2026-07-06 — the
-- 24-arg overload ending in p_original_document_id from
-- 20260705-create-document-atomic-original-document-id.sql). The ONLY changes:
--   * two new trailing params:
--       p_rounding    numeric DEFAULT 0
--       p_round_total boolean DEFAULT false
--     (DEFAULTs keep every existing named-param caller working unchanged)
--   * those two columns added to the documents INSERT list
--   * the money-validation check widened from
--       ABS(p_total - (p_subtotal + p_vat)) > tol
--     to
--       ABS(p_total - (p_subtotal + p_vat + p_rounding)) > tol
--     so a rounded total (total = subtotal + vat + rounding) passes.
-- Signature order, the auth guard, exempt vat=0 check, item-sum check, counter
-- logic, SECURITY DEFINER, owner, SET search_path, and the items insert are
-- byte-for-byte identical.
--
-- Because the new params change the argument list, this is a NEW overload. We
-- DROP the prior 24-arg overload first so exactly ONE function remains (a bare
-- call would otherwise be ambiguous — "function is not unique"). All existing
-- callers pass named params and resolve cleanly to the single remaining 26-arg
-- function. Grants are re-asserted for the new signature (authenticated +
-- service_role only; never PUBLIC/anon).

DROP FUNCTION IF EXISTS public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid
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
  p_round_total boolean DEFAULT false
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
  IF ABS(COALESCE(p_total, 0) - (COALESCE(p_subtotal, 0) + COALESCE(p_vat, 0) + COALESCE(p_rounding, 0))) > v_tol THEN
    RAISE EXCEPTION 'inconsistent totals: total (%) <> subtotal (%) + vat (%) + rounding (%)',
      p_total, p_subtotal, p_vat, p_rounding;
  END IF;

  SELECT COALESCE(SUM((item->>'total')::numeric), 0) INTO v_item_sum
  FROM jsonb_array_elements(p_items) AS item;
  IF ABS(v_item_sum - COALESCE(p_subtotal, 0)) > v_tol THEN
    RAISE EXCEPTION 'item totals (%) do not sum to subtotal (%)',
      v_item_sum, p_subtotal;
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
    client_tax_id, original_document_id, rounding, round_total
  ) VALUES (
    p_id, p_business_id, p_type, v_number, p_date, p_client_id, p_client_name,
    p_subject, p_status, p_subtotal, p_vat, p_total, p_payment_method, p_notes,
    COALESCE(p_currency, 'ILS'), COALESCE(p_exchange_rate, 1),
    COALESCE(p_subtotal_ils, p_subtotal), COALESCE(p_vat_ils, p_vat),
    COALESCE(p_total_ils, p_total), COALESCE(p_zero_rated, false),
    NULLIF(p_client_tax_id, ''), p_original_document_id,
    COALESCE(p_rounding, 0), COALESCE(p_round_total, false)
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

-- Re-assert intended grants for the NEW 26-arg signature (authenticated +
-- service_role only; no PUBLIC/anon).
REVOKE EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean
) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_document_atomic(
  uuid, uuid, text, date, uuid, text, text, text, numeric, numeric, numeric,
  text, text, jsonb, text, numeric, numeric, numeric, numeric, boolean, text,
  integer, uuid, numeric, boolean
) TO service_role;

-- scripts/migrations/20260609-multi-currency.sql
-- Multi-currency: per-document currency + rate + ₪-equivalent snapshot + zero-rated.
-- Backward compatible: existing rows backfill to ILS / rate 1 / *_ils = * / not zero-rated.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'ILS',
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(14,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subtotal_ils NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS vat_ils NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS total_ils NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS zero_rated BOOLEAN NOT NULL DEFAULT false;

UPDATE documents
  SET subtotal_ils = COALESCE(subtotal_ils, subtotal),
      vat_ils      = COALESCE(vat_ils, vat),
      total_ils    = COALESCE(total_ils, total)
  WHERE subtotal_ils IS NULL OR vat_ils IS NULL OR total_ils IS NULL;

CREATE OR REPLACE FUNCTION public.create_document_atomic(
  p_business_id uuid,
  p_id uuid,
  p_type text,
  p_date date,
  p_client_id uuid,
  p_client_name text,
  p_subject text,
  p_status text,
  p_subtotal numeric,
  p_vat numeric,
  p_total numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb,
  p_currency text DEFAULT 'ILS',
  p_exchange_rate numeric DEFAULT 1,
  p_subtotal_ils numeric DEFAULT NULL,
  p_vat_ils numeric DEFAULT NULL,
  p_total_ils numeric DEFAULT NULL,
  p_zero_rated boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_number int;
  v_business_user uuid;
BEGIN
  SELECT user_id INTO v_business_user FROM businesses WHERE id = p_business_id;
  IF v_business_user IS NULL OR v_business_user <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO document_counters (business_id, doc_type, next_number)
  VALUES (p_business_id, p_type, CASE WHEN p_type = 'receipt' THEN 1001 ELSE 201 END)
  ON CONFLICT (business_id, doc_type) DO NOTHING;

  UPDATE document_counters
  SET next_number = next_number + 1
  WHERE business_id = p_business_id AND doc_type = p_type
  RETURNING next_number - 1 INTO v_number;

  INSERT INTO documents (
    id, business_id, type, number, date, client_id, client_name,
    subject, status, subtotal, vat, total, payment_method, notes,
    currency, exchange_rate, subtotal_ils, vat_ils, total_ils, zero_rated
  ) VALUES (
    p_id, p_business_id, p_type, v_number, p_date, p_client_id, p_client_name,
    p_subject, p_status, p_subtotal, p_vat, p_total, p_payment_method, p_notes,
    COALESCE(p_currency, 'ILS'), COALESCE(p_exchange_rate, 1),
    COALESCE(p_subtotal_ils, p_subtotal), COALESCE(p_vat_ils, p_vat),
    COALESCE(p_total_ils, p_total), COALESCE(p_zero_rated, false)
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
$$;

GRANT EXECUTE ON FUNCTION public.create_document_atomic TO authenticated;

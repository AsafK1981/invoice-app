-- Atomic document creation: allocates the next number AND inserts doc + items
-- in a single transaction. If insert fails, counter stays at its previous value.
--
-- Replaces the old client-side flow:
--   1. RPC get_next_doc_number  → counter advances
--   2. INSERT documents          → if this fails, counter has a gap
--
-- New flow: single RPC create_document_atomic. Counter only advances on success.

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
  p_items jsonb
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
  SELECT user_id INTO v_business_user
  FROM businesses WHERE id = p_business_id;
  IF v_business_user IS NULL OR v_business_user <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO document_counters (business_id, doc_type, next_number)
  VALUES (
    p_business_id,
    p_type,
    CASE WHEN p_type = 'receipt' THEN 1001 ELSE 201 END
  )
  ON CONFLICT (business_id, doc_type) DO NOTHING;

  UPDATE document_counters
  SET next_number = next_number + 1
  WHERE business_id = p_business_id AND doc_type = p_type
  RETURNING next_number - 1 INTO v_number;

  INSERT INTO documents (
    id, business_id, type, number, date, client_id, client_name,
    subject, status, subtotal, vat, total, payment_method, notes
  ) VALUES (
    p_id, p_business_id, p_type, v_number, p_date, p_client_id, p_client_name,
    p_subject, p_status, p_subtotal, p_vat, p_total, p_payment_method, p_notes
  );

  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO document_items (id, document_id, product_id, description, quantity, unit_price, total, sort_order)
    SELECT
      (item->>'id')::uuid,
      p_id,
      NULLIF(item->>'product_id', '')::uuid,
      item->>'description',
      (item->>'quantity')::numeric,
      (item->>'unit_price')::numeric,
      (item->>'total')::numeric,
      (idx - 1)::int
    FROM jsonb_array_elements(p_items) WITH ORDINALITY arr(item, idx);
  END IF;

  RETURN json_build_object('id', p_id, 'number', v_number);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_document_atomic TO authenticated;

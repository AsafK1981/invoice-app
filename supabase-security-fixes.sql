-- Fix Supabase Security Advisor warnings
-- Run this in SQL Editor

-- Fix: Function Search Path Mutable
-- Explicitly set search_path on our function for security
CREATE OR REPLACE FUNCTION get_next_doc_number(p_business_id UUID, p_doc_type TEXT)
RETURNS INT AS $$
DECLARE
  v_number INT;
BEGIN
  INSERT INTO document_counters (business_id, doc_type, next_number)
  VALUES (p_business_id, p_doc_type,
    CASE WHEN p_doc_type = 'receipt' THEN 1001
         WHEN p_doc_type = 'quote' THEN 201
         ELSE 1 END)
  ON CONFLICT (business_id, doc_type) DO NOTHING;

  UPDATE document_counters
  SET next_number = next_number + 1
  WHERE business_id = p_business_id AND doc_type = p_doc_type
  RETURNING next_number - 1 INTO v_number;

  RETURN v_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

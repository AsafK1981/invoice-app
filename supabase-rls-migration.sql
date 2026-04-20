-- Migration: Add user isolation (RLS) so each user only sees their own data
-- Run this in Supabase SQL Editor

-- Step 1: Add user_id column to businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Step 2: Link existing businesses to existing users (if any)
-- This sets the first user as owner of all existing businesses
UPDATE businesses SET user_id = (SELECT id FROM auth.users LIMIT 1) WHERE user_id IS NULL;

-- Step 3: Enable RLS on all tables
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Step 4: Policies for businesses table
CREATE POLICY "Users can view own businesses" ON businesses
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own businesses" ON businesses
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own businesses" ON businesses
  FOR UPDATE USING (user_id = auth.uid());

-- Step 5: Policies for clients (via business_id)
CREATE POLICY "Users can view own clients" ON clients
  FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own clients" ON clients
  FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own clients" ON clients
  FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own clients" ON clients
  FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- Step 6: Policies for products
CREATE POLICY "Users can view own products" ON products
  FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own products" ON products
  FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own products" ON products
  FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own products" ON products
  FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- Step 7: Policies for documents
CREATE POLICY "Users can view own documents" ON documents
  FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own documents" ON documents
  FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own documents" ON documents
  FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- Step 8: Policies for document_items (via document -> business)
CREATE POLICY "Users can view own document items" ON document_items
  FOR SELECT USING (document_id IN (SELECT id FROM documents WHERE business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())));

CREATE POLICY "Users can insert own document items" ON document_items
  FOR INSERT WITH CHECK (document_id IN (SELECT id FROM documents WHERE business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())));

CREATE POLICY "Users can delete own document items" ON document_items
  FOR DELETE USING (document_id IN (SELECT id FROM documents WHERE business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())));

-- Step 9: Policies for document_counters
CREATE POLICY "Users can view own counters" ON document_counters
  FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own counters" ON document_counters
  FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own counters" ON document_counters
  FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- Step 10: Policies for expenses
CREATE POLICY "Users can view own expenses" ON expenses
  FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own expenses" ON expenses
  FOR INSERT WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own expenses" ON expenses
  FOR UPDATE USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own expenses" ON expenses
  FOR DELETE USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- Step 11: Public read access for document viewing (email links)
-- Allow anyone to read a document + its items + the business info (for the public /view/[id] page)
CREATE POLICY "Public can view documents by ID" ON documents
  FOR SELECT USING (true);

CREATE POLICY "Public can view document items" ON document_items
  FOR SELECT USING (true);

CREATE POLICY "Public can view business info for documents" ON businesses
  FOR SELECT USING (true);

CREATE POLICY "Public can view client info for documents" ON clients
  FOR SELECT USING (true);

-- Step 12: Allow the get_next_doc_number function to work with RLS
-- The function runs as SECURITY DEFINER so it bypasses RLS
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

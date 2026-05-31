-- Expense receipts: each expense can have one attached receipt/document
-- (photo, PDF, screenshot) used for the OCR auto-fill. We keep the path
-- to the file in storage; the bucket is private and RLS scopes access
-- to the file owner via the first folder segment.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can view own expense receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can insert own expense receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own expense receipts" ON storage.objects;

CREATE POLICY "Users can view own expense receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can insert own expense receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own expense receipts" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

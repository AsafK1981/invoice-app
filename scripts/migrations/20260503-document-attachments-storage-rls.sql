-- Storage policies for document-attachments bucket.
-- File path format: "<document_id>/<filename>" — so the first path segment
-- identifies which document this file belongs to. Each policy resolves the
-- document_id from the path and checks the caller owns that document via
-- businesses.user_id = auth.uid().

DROP POLICY IF EXISTS "Users can read own document attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own document attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own document attachments" ON storage.objects;

CREATE POLICY "Users can read own document attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'document-attachments'
    AND (substring(name FROM '^([^/]+)'))::uuid IN (
      SELECT d.id FROM documents d
      JOIN businesses b ON b.id = d.business_id
      WHERE b.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can upload own document attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'document-attachments'
    AND (substring(name FROM '^([^/]+)'))::uuid IN (
      SELECT d.id FROM documents d
      JOIN businesses b ON b.id = d.business_id
      WHERE b.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own document attachments" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'document-attachments'
    AND (substring(name FROM '^([^/]+)'))::uuid IN (
      SELECT d.id FROM documents d
      JOIN businesses b ON b.id = d.business_id
      WHERE b.user_id = auth.uid()
    )
  );

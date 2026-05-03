-- Document attachments: each document can have 0..N files attached
-- (e.g., signed contract PDF, photo of paid invoice). Files live in
-- the `document-attachments` Supabase Storage bucket.

CREATE TABLE IF NOT EXISTS document_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  filename text NOT NULL,
  file_size integer NOT NULL,
  content_type text,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_attachments_document_id_idx ON document_attachments(document_id);

ALTER TABLE document_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own attachments" ON document_attachments;
DROP POLICY IF EXISTS "Users can insert own attachments" ON document_attachments;
DROP POLICY IF EXISTS "Users can delete own attachments" ON document_attachments;

CREATE POLICY "Users can view own attachments" ON document_attachments
  FOR SELECT TO authenticated
  USING (document_id IN (
    SELECT d.id FROM documents d
    JOIN businesses b ON b.id = d.business_id
    WHERE b.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own attachments" ON document_attachments
  FOR INSERT TO authenticated
  WITH CHECK (document_id IN (
    SELECT d.id FROM documents d
    JOIN businesses b ON b.id = d.business_id
    WHERE b.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete own attachments" ON document_attachments
  FOR DELETE TO authenticated
  USING (document_id IN (
    SELECT d.id FROM documents d
    JOIN businesses b ON b.id = d.business_id
    WHERE b.user_id = auth.uid()
  ));

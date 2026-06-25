-- Server-side drafts for unfinished documents. A draft must NOT consume a real
-- invoice number (Israeli numbering must be gap-free), so drafts live in their
-- own table and only become a numbered document when finalized. Owner-scoped via
-- RLS (private per authenticated user — NOT public data, so RLS is correct here).

CREATE TABLE IF NOT EXISTS document_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  doc_type text NOT NULL,
  title text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_drafts_business_updated_idx
  ON document_drafts (business_id, updated_at DESC);

ALTER TABLE document_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_drafts_owner_all ON document_drafts;
CREATE POLICY document_drafts_owner_all ON document_drafts
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON document_drafts TO authenticated;

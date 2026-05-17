-- Email open tracking. When we send a document via email we embed a 1×1
-- tracking pixel pointing at /api/email/track/<doc_id>.gif. When the
-- recipient's mail client loads the pixel, our route stamps
-- email_opened_at (and email_open_count for repeat opens) on the doc.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS email_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_open_count integer NOT NULL DEFAULT 0;

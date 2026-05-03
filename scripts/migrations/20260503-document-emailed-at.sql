-- Track when a document was actually emailed (separate from doc lifecycle status).
--
-- Until now, documents.status was set to 'sent' on creation for non-receipts,
-- which made it impossible to tell "I haven't emailed this yet" from "emailed
-- but not paid yet". User Asaf Kotler hit this on 2026-05-03 — clicked the
-- email button, the toast said success, but no email arrived, and the page
-- gave no indication of whether the send actually succeeded.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;

COMMENT ON COLUMN documents.emailed_at IS
  'Timestamp of the most recent successful email send. NULL means never emailed.';

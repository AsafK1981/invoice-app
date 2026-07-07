-- Legal: הוראות ניהול ספרים סעיף 18ב — mark exactly ONE output of each document
-- as "מקור" (original) and every reproduction as "העתק" (copy).
--
-- We track the first authoritative emission of the document with a single
-- timestamp. While original_issued_at IS NULL the document renders "מקור";
-- once it is set (on the first email send / PDF download / print), every later
-- reprint/re-download/re-send renders "העתק". A שכפול (duplicate) creates a new
-- numbered row with original_issued_at NULL → its own fresh "מקור".
--
-- BACKFILL: a document that was already emailed to a customer has already had
-- its מקור delivered, so future renders must be העתק. Seed original_issued_at
-- from emailed_at for those rows.
--
-- NOTE (immutability trigger): original_issued_at is deliberately NOT part of the
-- enforce_document_immutability() blocked set — it is metadata set ONCE post-issue
-- and setting it (including on an already-issued, status<>'draft' document) must
-- remain allowed. The trigger only guards the financial/identity columns.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded backfill.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS original_issued_at TIMESTAMPTZ;

COMMENT ON COLUMN documents.original_issued_at IS
  'When the document''s מקור (original) was first emitted to the customer (first email/download/print). NULL ⇒ renders "מקור"; set ⇒ renders "העתק". Set once, idempotently (only when NULL). הוראות ניהול ספרים 18ב.';

UPDATE documents
  SET original_issued_at = emailed_at
  WHERE emailed_at IS NOT NULL
    AND original_issued_at IS NULL;

-- Track WHEN a document was paid + the bank/payment reference.
-- Status = 'paid' already exists as a state; this adds the auditable
-- "paid on date X via reference Y" data used by:
--   1) The bank-import-matcher to mark an invoice paid against a CSV row
--   2) The annual journal (פנקסי חשבונות) to show payment dates explicitly
--   3) Future overdue/dunning logic that wants to compute days-to-pay
-- Both columns are nullable — historical documents marked paid via the
-- old UI won't backfill these.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

COMMENT ON COLUMN documents.paid_at IS
  'When the document was marked paid. Set by bank-import-matcher or manual edit.';

COMMENT ON COLUMN documents.payment_reference IS
  'Free-form payment reference (bank transaction id, Bit ref, etc.) — for reconciliation.';

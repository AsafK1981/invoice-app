-- Track quote → receipt conversion as a real DB link.
--
-- The "המר לקבלה" button on a quote creates a new receipt prefilled
-- with the quote's items. Until now the only connection between the
-- two docs was a free-text note "הומר מהצעת מחיר #X" — no programmatic
-- way to:
--   * Find the receipt that was issued against a given quote
--   * Prevent the user from accidentally converting the same quote
--     twice into two different receipts
--   * Render a click-through link from receipt → original quote
--   * Auto-flip the source quote to "paid" status when the receipt
--     is created (since you only convert when payment arrives)
--
-- Self-referencing FK with ON DELETE SET NULL: if the receipt gets
-- deleted (e.g. test data), the link clears so the quote becomes
-- convertible again.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS converted_to_id UUID
  REFERENCES documents(id) ON DELETE SET NULL;

COMMENT ON COLUMN documents.converted_to_id IS
  'When a quote is converted to a receipt/tax-invoice (because the client paid), this points to the resulting doc. Allows bidirectional UI links and prevents accidental double-conversion.';

CREATE INDEX IF NOT EXISTS idx_documents_converted_to_id
  ON documents(converted_to_id)
  WHERE converted_to_id IS NOT NULL;

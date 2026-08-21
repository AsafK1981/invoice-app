-- ============================================================================
-- invoice_proposals.intended_document_id (2026-08-21, same day as the table)
--
-- Idempotency key for approval. Without it the approve flow has a hole that
-- the conditional claim does NOT cover:
--
--   1. claim succeeds        (proposal -> approved)
--   2. create_document_atomic COMMITS document #N
--   3. the HTTP response is lost / the tab dies / attach fails
--   4. the error path hands the proposal back to pending
--   5. the owner retries -> a fresh uuid -> document #N+1
--
--   Two real, immutable, separately-numbered documents for one month.
--
-- The fix: the client picks the document's uuid BEFORE claiming and stores it
-- here. A retry reuses that same uuid, so either
--   * the document already exists  -> we find it and just link it, or
--   * it never existed             -> we create it with that id,
-- and because `documents.id` is the primary key, a duplicate insert fails
-- loudly instead of minting a second number.
--
-- It also makes a crash between (1) and (2) recoverable: a row left
-- status='approved' with document_id IS NULL is a half-finished approval, and
-- the dashboard resurfaces it for exactly that reason.
--
-- Idempotent. Apply with:
--   node scripts/run-sql-file.mjs scripts/migrations/20260821-invoice-proposals-intended-doc.sql
-- ============================================================================

ALTER TABLE invoice_proposals
  ADD COLUMN IF NOT EXISTS intended_document_id uuid;

-- Half-finished approvals, the set the dashboard has to resurface.
CREATE INDEX IF NOT EXISTS invoice_proposals_unfinished_idx
  ON invoice_proposals (business_id)
  WHERE status = 'approved' AND document_id IS NULL;

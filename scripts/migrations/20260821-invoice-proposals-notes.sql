-- ============================================================================
-- invoice_proposals.notes (2026-08-21)
--
-- The per-line breakdown that goes in the document's הערות block, e.g.
--
--   18/07/2026<TAB>אודיטוריום ספיר כפר סבא<TAB>1550.00 = נגינה (1200 שח) + נהיגה (350 שח)
--
-- Every invoice Asaf has sent טים טדי carries this (documents #90002-#90005
-- and the receipts converted from them), written by hand each month. The
-- first version of the proposal flow parsed the date / venue / amount /
-- "עבור" out of the workbook but used them only for the approval card's
-- preview, so an approved document would have gone out WITHOUT the breakdown
-- the client is used to seeing. This column carries it through to the issued
-- document.
--
-- `.doc-info-body` renders notes with white-space: pre-wrap, so the newlines
-- and tabs survive onto the client-facing page and the PDF.
--
-- Idempotent. Apply with:
--   node scripts/run-sql-file.mjs scripts/migrations/20260821-invoice-proposals-notes.sql
-- ============================================================================

ALTER TABLE invoice_proposals
  ADD COLUMN IF NOT EXISTS notes text;

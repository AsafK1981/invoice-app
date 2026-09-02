-- ============================================================================
-- recurring_suggestions_enabled (2026-09-01)
--
-- The daily /api/cron/recurring-proposals job notices that a business issues
-- roughly the same document to the same client around the same day every
-- month, and prepares it as an invoice_proposals row for one-click approval.
-- This column is the owner's off switch for that, set from the תזכורות page.
--
-- Default TRUE: the suggestion only ever appears for a cadence the owner
-- demonstrably already has (3+ occurrences, roughly monthly), it is a card and
-- never a document, and the card itself offers "לא לזהות יותר את זה". An
-- opt-in default would mean the feature exists for nobody.
--
-- APPLY THIS BEFORE DEPLOYING the code that reads/writes the column:
-- saveBusiness() writes it on every settings save, so an un-migrated database
-- would reject every business settings save with 42703. (The cron itself
-- degrades gracefully - it falls back to the pre-migration column list and
-- treats everyone as opted in - but the settings page does not.)
--
-- Idempotent. Apply with:
--   node scripts/run-sql-file.mjs scripts/migrations/20260901-recurring-suggestions.sql
-- ============================================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS recurring_suggestions_enabled boolean NOT NULL DEFAULT true;

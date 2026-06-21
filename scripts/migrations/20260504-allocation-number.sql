-- Manual entry path for מספר הקצאה (Tax Authority allocation number)
-- required on חשבונית מס above the annual threshold (חשבונית ישראל system).
--
-- Phase 1: manual entry. User submits the doc on the gov portal
-- (https://www.gov.il/he/pages/invoices-israel), gets back an allocation number, pastes
-- it into the app. App stores + prints it on the doc.
--
-- Phase 2 (future, not yet built): API integration with the gov system
-- so the app submits and retrieves the number automatically. Will need
-- a digital signing certificate (Comsign / PersonalID) per document.
--
-- This is irrelevant for עוסק פטור users (they can't issue tax
-- invoices) — only עוסק מורשה / company businesses will see the UI.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS allocation_number TEXT,
  ADD COLUMN IF NOT EXISTS allocation_set_at TIMESTAMPTZ;

COMMENT ON COLUMN documents.allocation_number IS
  'מספר הקצאה from חשבונית ישראל (Tax Authority allocation system). Required on tax invoices above threshold.';
COMMENT ON COLUMN documents.allocation_set_at IS
  'When the allocation number was entered into the app. NULL means none set.';

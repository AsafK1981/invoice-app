-- Per-business "default notes" that auto-prefill the notes field on every
-- new document. Useful for boilerplate the user types every time
-- (payment terms, return policy, etc).

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS default_doc_notes text;

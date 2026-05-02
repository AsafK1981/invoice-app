-- Add bank / payment fields to businesses so documents can show
-- "Where to pay" info to the client.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_branch text,
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS payment_notes text;

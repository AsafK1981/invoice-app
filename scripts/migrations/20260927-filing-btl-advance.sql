-- Filing-deadline reminder with the amount due: the owner's fixed monthly
-- Bituach Leumi advance (מקדמת ביטוח לאומי, the sum printed in the payment
-- booklet), so the reminder before the 15th can say how much to pay.
--
-- Whole shekels, nullable: NULL means the owner never entered it and the
-- reminder falls back to the plain deadline text. The app never guesses it.
-- Written by the owner from /obligations (existing owner-only RLS and grants
-- on filing_preferences cover the new column); read by the reminder cron
-- (service_role).
--
-- Spec: docs/superpowers/specs/2026-09-27-filing-reminder-amounts-design.md
--
-- APPLY THIS BEFORE DEPLOYING the code that reads/writes it: the obligations
-- page selects the column by name, so the page fails to load without it.

BEGIN;

-- ADD COLUMN takes an ACCESS EXCLUSIVE lock on filing_preferences; never wait
-- on a busy table indefinitely (same guard as 20260915-filing-preferences.sql).
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.filing_preferences
  ADD COLUMN IF NOT EXISTS btl_monthly_advance integer
  CHECK (btl_monthly_advance IS NULL OR (btl_monthly_advance >= 0 AND btl_monthly_advance <= 1000000));

COMMIT;

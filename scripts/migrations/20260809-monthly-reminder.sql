-- Monthly document reminder (2026-08-09)
--
-- Opt-in nudge sent once a month (1st or 15th, business's choice) reminding
-- the owner to issue outstanding documents. Cron workflow
-- `monthly-reminder-daily.yml` calls the /api/monthly-reminder/run endpoint
-- every morning; the endpoint only acts on businesses whose chosen day
-- matches today (Asia/Jerusalem) and skips resending within the same
-- calendar month via monthly_reminder_last_sent.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS monthly_reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monthly_reminder_day smallint NOT NULL DEFAULT 1 CHECK (monthly_reminder_day IN (1, 15)),
  ADD COLUMN IF NOT EXISTS monthly_reminder_last_sent date;

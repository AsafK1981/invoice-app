-- Monthly reminder v2: multiple days, chosen hour, per-channel opt-in.
--
-- Ships the same day as the v1 columns (commit eac8efa) and zero businesses
-- have opted in yet (verified in prod), so the old single-day column is
-- dropped outright rather than migrated - there is no data to preserve.
--
-- monthly_reminder_enabled and monthly_reminder_last_sent are untouched.

ALTER TABLE businesses DROP COLUMN IF EXISTS monthly_reminder_day;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS monthly_reminder_days smallint[] NOT NULL DEFAULT '{1}';

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS monthly_reminder_hour smallint NOT NULL DEFAULT 9
    CHECK (monthly_reminder_hour BETWEEN 0 AND 23);

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS monthly_reminder_channels text[] NOT NULL DEFAULT '{email,inapp}';

-- Auto customer dunning — 3-stage escalation (day 3 / 14 / 30 after
-- the invoice issue date) for unpaid quotes + tax invoices.
--
-- Cron workflow `dunning-daily.yml` calls the /api/dunning/run endpoint
-- each morning. The endpoint scans for matching docs, sends a polite
-- reminder email to the client, and logs to dunning_log so each
-- (document, day_bucket) pair sends at most once.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS dunning_enabled boolean DEFAULT false NOT NULL;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS dunning_from_name text;

COMMENT ON COLUMN businesses.dunning_enabled IS
  'When true, the daily dunning cron sends reminder emails for unpaid invoices from this business.';
COMMENT ON COLUMN businesses.dunning_from_name IS
  'Optional friendly From name on dunning emails (defaults to business name).';

CREATE TABLE IF NOT EXISTS dunning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_bucket smallint NOT NULL CHECK (day_bucket IN (3, 14, 30)),
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_to text NOT NULL,
  success boolean NOT NULL,
  error_message text,
  UNIQUE (document_id, day_bucket)
);

CREATE INDEX IF NOT EXISTS idx_dunning_log_document ON dunning_log(document_id);
CREATE INDEX IF NOT EXISTS idx_dunning_log_business ON dunning_log(business_id);
CREATE INDEX IF NOT EXISTS idx_dunning_log_sent_at ON dunning_log(sent_at DESC);

-- RLS — only the user who owns the business can read THEIR dunning log
-- entries. Service role bypasses RLS for the cron itself.
ALTER TABLE dunning_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own dunning log" ON dunning_log;
CREATE POLICY "Users can read own dunning log" ON dunning_log
  FOR SELECT TO authenticated
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

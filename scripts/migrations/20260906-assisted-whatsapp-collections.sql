-- ============================================================================
-- Assisted WhatsApp collections (2026-09-06)
--
-- The daily dunning run gets a second, non-sending pass: when an open
-- receivable (חשבונית מס / חשבון עסקה, status 'sent', unpaid, not converted)
-- reaches day 3 / 14 / 30 and the client has a phone, the OWNER gets one
-- notification saying a WhatsApp reminder is ready. Nothing is sent to the
-- client by this app - the owner opens the document and sends it from their
-- own WhatsApp with one tap. That is why the switch defaults to true: no
-- message can leave the account without a human tap, and it costs nothing.
--
-- WHAT CHANGES
--
--  * businesses.dunning_whatsapp_enabled - opt-out switch for that pass.
--    Independent of dunning_enabled (email to clients), which stays opt-in
--    and default false, because that one DOES send on its own.
--  * dunning_log.channel - 'email' for every row written so far (the column
--    default), 'whatsapp_assist' for a prepared-for-the-owner reminder. The
--    dedupe key grows to (document_id, day_bucket, channel), which keeps the
--    old semantics exactly for email rows (all of them carry 'email') while
--    letting the assisted pass log its own once-per-stage row.
--    For a 'whatsapp_assist' row, sent_to is the number the owner was
--    prompted to message and success means "the owner was notified", NOT
--    that the client received anything.
--  * push_kinds gains the new 'whatsapp_reminder_ready' kind for every
--    business that already has a non-empty list. Those owners pressed the
--    button in הגדרות and were opted in to every kind that existed at that
--    moment; leaving the new one out would silently drop the one push this
--    feature exists to deliver. Businesses with an empty list (push off)
--    stay untouched - nothing starts pushing to a device that never asked.
--
-- APPLY THIS BEFORE DEPLOYING the code that reads/writes it. The dunning
-- route now selects businesses with
-- .or("dunning_enabled.eq.true,dunning_whatsapp_enabled.eq.true"), so on a
-- deploy that runs ahead of this migration that query errors and the whole
-- daily run does nothing (it reports "no businesses opted in"). It fails
-- closed: no duplicate emails, no reminders, until this file is applied.
--
-- Idempotent. Apply with:
--   node scripts/run-sql-file.mjs scripts/migrations/20260906-assisted-whatsapp-collections.sql
-- ============================================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS dunning_whatsapp_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN businesses.dunning_whatsapp_enabled IS
  'When true, the daily dunning run notifies the OWNER that a WhatsApp reminder is ready for an overdue invoice. The owner sends it from their own number; the app never messages the client on this path.';

ALTER TABLE dunning_log
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email';

COMMENT ON COLUMN dunning_log.channel IS
  '''email'' = a reminder this app emailed to the client. ''whatsapp_assist'' = a reminder prepared for the owner to send from their own WhatsApp (sent_to is the client phone, success means the owner was notified).';

-- Widen the dedupe key from (document_id, day_bucket) to
-- (document_id, day_bucket, channel). Every pre-existing row has
-- channel = 'email', so email keeps its one-per-(document, stage) guarantee.
ALTER TABLE dunning_log
  DROP CONSTRAINT IF EXISTS dunning_log_document_id_day_bucket_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dunning_log_document_id_day_bucket_channel_key'
  ) THEN
    ALTER TABLE dunning_log
      ADD CONSTRAINT dunning_log_document_id_day_bucket_channel_key
      UNIQUE (document_id, day_bucket, channel);
  END IF;
END $$;

-- See the header: only businesses that already opted in to push at all.
UPDATE businesses
   SET push_kinds = array_append(push_kinds, 'whatsapp_reminder_ready')
 WHERE cardinality(push_kinds) > 0
   AND NOT ('whatsapp_reminder_ready' = ANY(push_kinds));

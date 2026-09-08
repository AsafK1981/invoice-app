-- 2026-09-09  Computerized documents: recipient consent + tax-officer notice
--
-- הוראות ניהול ספרים, סעיף 18ב:
--   (ג) "המסמך הממוחשב יישלח רק למי שהביע את הסכמתו, בכתב או באופן ממוחשב,
--        לקבל מסמכים ממוחשבים מאותו שולח, לפני קבלת המסמך הממוחשב הראשון".
--        The recipient may revoke, and the consent or its revocation is kept
--        "כחלק בלתי נפרד ממערכת החשבונות". Hence three columns on clients,
--        written by the app (public /view route, service role) or by the owner
--        (a consent given in writing outside the app), never deleted.
--   (ב) "נישום המבקש לשלוח מסמכים ממוחשבים, יודיע על כך לפקיד השומה בדואר
--        רשום, לפני משלוח המסמך הממוחשב הראשון". The app cannot mail the
--        letter; it records when the owner confirmed they did.
--
-- Apply with:
--   node scripts/run-sql-file.mjs --reason "18ב consent + tax-officer notice" scripts/migrations/20260909-computerized-documents-consent.sql
--
-- RLS: no new policies. clients and businesses already have owner-scoped
-- SELECT/UPDATE policies (20260816-core-rls-policies-snapshot.sql), which
-- cover the new columns; the public consent route writes as service_role.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS computerized_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS computerized_consent_source text,
  ADD COLUMN IF NOT EXISTS computerized_consent_revoked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_computerized_consent_source_check'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_computerized_consent_source_check
      CHECK (
        computerized_consent_source IS NULL
        OR computerized_consent_source IN ('download', 'button', 'email', 'written', 'manual')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.clients.computerized_consent_at IS
  '18ב(ג): when this client agreed to receive computerized documents from this business. Set once; a later revocation is recorded separately, never by clearing this.';
COMMENT ON COLUMN public.clients.computerized_consent_source IS
  'How the consent was given: download (customer downloaded the PDF from /view), button (explicit click on /view), email (reply), written (paper, recorded by the owner), manual (owner recorded it).';
COMMENT ON COLUMN public.clients.computerized_consent_revoked_at IS
  '18ב(ג): when the client withdrew consent. From then on documents to this client are not computerized documents until a new consent is recorded.';

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS tax_officer_notice_sent_at timestamptz;

COMMENT ON COLUMN public.businesses.tax_officer_notice_sent_at IS
  '18ב(ב): the owner confirmed the registered-mail notice to פקיד השומה was sent, before the first computerized document. NULL means not yet confirmed.';

COMMIT;

-- 2026-09-16  Client payment terms (תנאי תשלום)
--
-- The cash-flow forecast dated an open invoice at issue + the median of that
-- client's own past days-to-pay. That cannot express "שוטף + 30", which counts
-- from the END OF THE INVOICE MONTH (so the 1st and the 28th of the same month
-- fall due on the same day), and it has nothing to say at all about a new
-- client. This column stores what was actually agreed; src/lib/payment-terms.ts
-- turns it into a date.
--
-- NULL is the default and is MEANINGFUL: "לפי היסטוריית התשלומים" - the
-- existing behaviour. Nothing is backfilled; guessing a term the owner never
-- agreed to would put wrong dates on the forecast and look like a fact.
--
-- Apply with:
--   node scripts/run-sql-file.mjs --reason "client payment terms column" scripts/migrations/20260916-client-payment-terms.sql
--
-- RLS: no new policies. clients already has owner-scoped SELECT/INSERT/UPDATE
-- policies (20260816-core-rls-policies-snapshot.sql), which cover this column.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded CHECK.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS payment_terms text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_payment_terms_check'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_payment_terms_check
      CHECK (
        payment_terms IS NULL
        OR payment_terms IN (
          'immediate',
          'net_15', 'net_30', 'net_45', 'net_60',
          'eom', 'eom_30', 'eom_60', 'eom_90'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.clients.payment_terms IS
  'תנאי התשלום שסוכמו עם הלקוח. immediate = מיידי; net_N = N ימים מתאריך החשבונית; eom = שוטף (סוף חודש החשבונית); eom_N = שוטף + N. NULL = לא סוכמו תנאים, ותחזית התזרים אומדת לפי חציון ימי התשלום בפועל.';

COMMIT;

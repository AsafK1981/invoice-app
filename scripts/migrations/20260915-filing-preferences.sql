-- Filing obligations calendar (/obligations): per-business preferences, the
-- deadlines the owner marked as filed, and which reminders were already sent.
--
-- One row per business, created when the owner first opens /obligations (the
-- app treats a missing row as the defaults). Reminders only go to businesses
-- with a row, so nobody who never opened the calendar is notified. Deadline keys are stable strings built by
-- src/lib/ita/filing-calendar.ts, e.g. "vat_periodic:2026-B4" or
-- "annual_report:2026". `filed` maps key -> ISO timestamp the owner ticked it;
-- `reminded` maps key -> ISO timestamp the daily cron notified, which is what
-- makes the cron idempotent (it never notifies a key twice).
--
-- Security: owner-only RLS through businesses.user_id, same shape as
-- document_signatures. No anon access. The cron uses service_role.
--
-- APPLY THIS BEFORE DEPLOYING the code that reads/writes it: the obligations
-- page and the reminder cron both select from this table.

BEGIN;

-- The push_kinds UPDATE below takes row locks on businesses; never wait on a
-- busy table indefinitely (same guard as 20260910-document-signatures.sql).
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.filing_preferences (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  vat_cadence text NOT NULL DEFAULT 'bimonthly' CHECK (vat_cadence IN ('monthly', 'bimonthly')),
  advance_cadence text NOT NULL DEFAULT 'bimonthly' CHECK (advance_cadence IN ('monthly', 'bimonthly')),
  detailed_reporter boolean NOT NULL DEFAULT false,
  has_employees boolean NOT NULL DEFAULT false,
  reminders_enabled boolean NOT NULL DEFAULT true,
  reminder_days_before smallint NOT NULL DEFAULT 3 CHECK (reminder_days_before BETWEEN 1 AND 14),
  filed jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filed) = 'object'),
  reminded jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(reminded) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.filing_preferences ENABLE ROW LEVEL SECURITY;

-- Clients read, create and update their own row; they never delete it (a full
-- data wipe uses service_role). Revoke everything first so Supabase's default
-- table privileges (DELETE, TRUNCATE, ...) do not linger for authenticated.
REVOKE ALL ON public.filing_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.filing_preferences TO authenticated;
GRANT ALL ON public.filing_preferences TO service_role;

DROP POLICY IF EXISTS "Owners can view own filing preferences" ON public.filing_preferences;
CREATE POLICY "Owners can view own filing preferences" ON public.filing_preferences
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Owners can insert own filing preferences" ON public.filing_preferences;
CREATE POLICY "Owners can insert own filing preferences" ON public.filing_preferences
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Owners can update own filing preferences" ON public.filing_preferences;
CREATE POLICY "Owners can update own filing preferences" ON public.filing_preferences
  FOR UPDATE TO authenticated
  USING (business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid()));

-- `reminded` is written by the cron only. An owner's client could otherwise
-- clear it and get the same reminder again, or fill it and silence reminders
-- in a way the settings switch would not show. Invoker rights on purpose: a
-- definer function would always see its owner's role.
CREATE OR REPLACE FUNCTION public.guard_filing_reminded()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.reminded := '{}'::jsonb;
    ELSIF NEW.reminded IS DISTINCT FROM OLD.reminded THEN
      NEW.reminded := OLD.reminded;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_filing_reminded() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_filing_reminded ON public.filing_preferences;
CREATE TRIGGER guard_filing_reminded
  BEFORE INSERT OR UPDATE ON public.filing_preferences
  FOR EACH ROW EXECUTE FUNCTION public.guard_filing_reminded();

-- The deadline reminder is a new notification kind. Owners who turned push on
-- were opted in to every kind that existed then; add this one for them, the
-- same way 20260906-assisted-whatsapp-collections.sql did. Push-off owners
-- (empty list) stay untouched.
UPDATE public.businesses
   SET push_kinds = array_append(push_kinds, 'filing_deadline')
 WHERE cardinality(push_kinds) > 0
   AND NOT ('filing_deadline' = ANY(push_kinds));

COMMIT;

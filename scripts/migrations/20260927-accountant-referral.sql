-- Accountant referral attribution (2026-09-27). Operator metadata only.
--
-- /from-accountant?ref=<slug> is the personal link each accountant gets in the
-- outreach email. The slug is stored ONCE on the business row created at
-- first app load (src/lib/business-init.ts), so both signup paths (email and
-- Google) are covered. It ranks the in-app directory (/find-accountant) and
-- feeds one admin card. It is never tenant content.
--
-- Deploy order matters: apply this BEFORE the code that sends referred_by
-- ships, and reload the PostgREST schema cache (the NOTIFY at the end), or
-- every new signup's business insert fails on an unknown column.
BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS referred_by text
  CHECK (referred_by IS NULL OR referred_by ~ '^[a-z0-9][a-z0-9-]{1,31}$');

COMMENT ON COLUMN public.businesses.referred_by IS
  'Accountant referral slug from /from-accountant?ref=, written only by the INSERT that creates the business; every UPDATE keeps the stored value. Directory ranking + admin count only.';

CREATE INDEX IF NOT EXISTS businesses_referred_by_idx
  ON public.businesses (referred_by)
  WHERE referred_by IS NOT NULL;

-- Insert-only, unconditionally: the UPDATE policy on businesses is a plain
-- user_id = auth.uid() with no column list, so without this any owner could
-- PATCH their own row and hand a referral to any accountant (council review,
-- 2026-09-27). No application path updates this column, so the trigger keeps
-- OLD.referred_by on every UPDATE, including NULL. Attributing an existing
-- business later is a service-role/SQL job, on purpose.
CREATE OR REPLACE FUNCTION public.freeze_business_referred_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.referred_by := OLD.referred_by;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS freeze_business_referred_by ON public.businesses;
CREATE TRIGGER freeze_business_referred_by
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.freeze_business_referred_by();

COMMIT;

-- PostgREST learns about the new column only after a schema reload.
NOTIFY pgrst, 'reload schema';

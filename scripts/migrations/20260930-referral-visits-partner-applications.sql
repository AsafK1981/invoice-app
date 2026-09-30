-- Accountant funnel, second step (2026-09-30). Operator metadata only.
--
-- referral_visits: one row per browser that opened an accountant's personal
--   link (/from-accountant?ref=<slug>). Until now the only signal was a
--   signup, so after 27 outreach emails there was no way to tell "nobody
--   clicked" from "they clicked and their clients have not signed up yet".
--   No IP, no user agent, no user id: a slug and a timestamp.
--
-- referral_visit_counts: the per-slug aggregate the admin dashboard reads, so
--   a flooded table cannot make /admin page through raw rows.
--
-- partner_applications: an accountant asking to be listed in the in-app
--   directory (/find-accountant) through the form on /accountants. The row IS
--   the written consent the listing rules require (consent_at), and it holds
--   exactly the contact fields they asked to publish.
--
-- All three are service-role only: RLS on with no policies, no anon or
-- authenticated grants, and the view runs as its caller (security_invoker).
-- Writes go through /api/referral-visit and /api/partner-apply, which
-- validate shape first and enforce a per-instance IP budget plus a global
-- rolling cap counted in the database (council review, 2026-09-30).
--
-- Deploy order: apply this BEFORE the code ships; /api/admin/stats reads the
-- view and the applications table.
BEGIN;

CREATE TABLE IF NOT EXISTS public.referral_visits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ref text NOT NULL CHECK (ref ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  visited_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_visits FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS referral_visits_ref_idx
  ON public.referral_visits (ref, visited_at);
CREATE INDEX IF NOT EXISTS referral_visits_visited_at_idx
  ON public.referral_visits (visited_at);
COMMENT ON TABLE public.referral_visits IS
  'One row per browser that opened an accountant referral link. Slug + timestamp only. Service role only.';

CREATE OR REPLACE VIEW public.referral_visit_counts
  WITH (security_invoker = true) AS
  SELECT ref,
         count(*)::bigint AS visits,
         min(visited_at) AS first_at,
         max(visited_at) AS last_at
  FROM public.referral_visits
  GROUP BY ref;
REVOKE ALL ON public.referral_visit_counts FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.partner_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  office text CHECK (office IS NULL OR char_length(office) <= 100),
  city text NOT NULL CHECK (char_length(city) BETWEEN 2 AND 60),
  email text NOT NULL CHECK (char_length(email) BETWEEN 5 AND 160),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 30),
  website text CHECK (website IS NULL OR char_length(website) <= 200),
  ref text CHECK (ref IS NULL OR ref ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  consent_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'listed', 'rejected'))
);
ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_applications FROM anon, authenticated;
-- One application per address: a second submit from the same accountant is
-- answered exactly like the first and stores nothing new.
CREATE UNIQUE INDEX IF NOT EXISTS partner_applications_email_key
  ON public.partner_applications (lower(email));
CREATE INDEX IF NOT EXISTS partner_applications_created_at_idx
  ON public.partner_applications (created_at);
COMMENT ON TABLE public.partner_applications IS
  'Accountants asking to be listed in the in-app directory; the row is their written consent and the contact fields they chose to publish. Service role only.';

COMMIT;

NOTIFY pgrst, 'reload schema';

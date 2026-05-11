-- Beta invite codes: lets the owner grant free Pro access to friends
-- and beta testers for a fixed duration without going through Polar.
-- Anon/authenticated clients should never read or write these tables
-- directly — all access is mediated by API routes that auth-check
-- (admin for create/list/delete, any logged-in user for redeem).

CREATE TABLE IF NOT EXISTS public.beta_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  notes text,
  max_redemptions integer NOT NULL DEFAULT 1 CHECK (max_redemptions >= 1),
  redemptions_count integer NOT NULL DEFAULT 0 CHECK (redemptions_count >= 0),
  days_granted integer NOT NULL DEFAULT 90 CHECK (days_granted >= 1),
  plan_tier text NOT NULL DEFAULT 'pro' CHECK (plan_tier IN ('free', 'pro')),
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS beta_invites_code_idx ON public.beta_invites (code);
CREATE INDEX IF NOT EXISTS beta_invites_active_idx ON public.beta_invites (active);

CREATE TABLE IF NOT EXISTS public.beta_invite_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.beta_invites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (invite_id, user_id)
);

CREATE INDEX IF NOT EXISTS beta_invite_redemptions_user_idx
  ON public.beta_invite_redemptions (user_id);

-- Lock down both tables. Service-role bypasses RLS, which is what
-- the API routes use. No anon / authenticated policies are added,
-- so direct client access is impossible.
ALTER TABLE public.beta_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_invite_redemptions ENABLE ROW LEVEL SECURITY;

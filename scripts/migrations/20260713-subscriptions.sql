-- Recurring subscription billing — scheduler work-queue + idempotent charge log.
--
-- Part of the Polar → Grow (Israeli direct card processing) migration
-- (plan: squishy-knitting-valiant.md, sections 3 & 4).
--
-- IMPORTANT — source of truth: `app_metadata.plan_*` on the auth user remains
-- the ENFORCEMENT source of truth (getPlanStatus reads it). This `subscriptions`
-- table is ONLY a scheduler index/work-queue so the daily recurring-billing cron
-- (/api/cron/subscription-billing) knows WHO to charge and WHEN, without scanning
-- every auth user's metadata. The billing callback
-- (src/app/api/billing/callback/route.ts) writes BOTH: app_metadata (truth) and
-- an upserted row here (queue).
--
-- Idempotency mirrors dunning_log's UNIQUE(document_id, day_bucket) idea: a
-- separate subscription_charge_log with UNIQUE(user_id, period_start) so a double
-- cron run in the same day can't double-charge. A success log row is written only
-- AFTER a successful charge (never on failure), so a transient failure retries on
-- the next run — same rule the dunning route uses.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  tier text NOT NULL DEFAULT 'pro',
  -- Billing interval, matching src/lib/plans.ts BillingInterval ("month"|"year").
  interval text NOT NULL DEFAULT 'month' CHECK (interval IN ('month', 'year')),
  provider text NOT NULL DEFAULT 'grow',
  -- The reusable Grow card token (app_metadata.grow_payment_token) the cron feeds
  -- to chargeToken(). Nullable: a row can exist before a token is captured.
  provider_token text,
  -- Date the current paid/trial period ends. When it's <= today, the cron charges
  -- the token for the next period. Advanced via calculateNextDue() on success.
  current_period_end date NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'past_due', 'canceled')),
  -- Dunning state for failed charges (day 1/3/5 retry escalation).
  retry_count int NOT NULL DEFAULT 0,
  first_failed_at timestamptz,
  last_charge_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_due
  ON public.subscriptions (status, current_period_end);
CREATE INDEX IF NOT EXISTS idx_subscriptions_business
  ON public.subscriptions (business_id);

COMMENT ON TABLE public.subscriptions IS
  'Scheduler work-queue for recurring Grow charges. app_metadata.plan_* remains the enforcement source of truth.';

-- Idempotent per-period charge log. period_start = the current_period_end value
-- that TRIGGERED the charge (the boundary being renewed). UNIQUE(user_id,
-- period_start) guarantees at most one successful charge per period even if the
-- cron runs twice in a day. Mirrors dunning_log's shape/rules.
CREATE TABLE IF NOT EXISTS public.subscription_charge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  amount numeric(12,2) NOT NULL,
  provider text NOT NULL DEFAULT 'grow',
  transaction_id text,
  -- The self-invoice (receipt) issued to the vendor business for this charge.
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  success boolean NOT NULL,
  charged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_subscription_charge_log_user
  ON public.subscription_charge_log (user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_charge_log_charged_at
  ON public.subscription_charge_log (charged_at DESC);

-- RLS: both tables hold billing state. Enable RLS with NO policies so only the
-- service-role client (the cron + the callback route) can read/write — same
-- posture as tax_authority_credentials. Users never touch these directly; their
-- plan state is surfaced from app_metadata via getPlanStatus.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_charge_log ENABLE ROW LEVEL SECURITY;

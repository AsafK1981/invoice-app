-- ============================================================================
-- Tranzila token persistence + authenticated checkout results (2026-09-23).
--
-- Background: chargeToken() in src/lib/tranzila.ts was proven against the live
-- test terminal on 2026-09-23 (a real hosted-page payment returned
-- Response 000 + TranzilaTK + expmonth/expyear; charging that token returned
-- error_code 0 + processor_response_code 000). What was still missing was a
-- place to KEEP that token and a way to know that the result payload claiming
-- "this customer paid" is really ours. This migration is that place.
--
-- Everything shipped alongside it is INERT: PAYMENT_PROVIDER stays "polar", so
-- no route below ever runs in production today. Applying this migration is
-- therefore safe on its own - it only adds nullable columns, one new table and
-- one partial index.
--
-- WHAT CHANGES
--
--  1. subscriptions gains the four card facts a Tranzila token charge needs
--     that the token itself does NOT carry (Tranzila support, 2026-09-23: "A
--     Tranzila token replaces only the full card number. It does not include
--     the card expiry date..."):
--       card_exp_month / card_exp_year - REQUIRED by chargeToken(). A row with
--         a token but no expiry cannot be charged; the cron treats that as OUR
--         data gap and skips it loudly, never as a declined card.
--       card_last4         - display only, already safe to store.
--       provider_terminal  - which terminal minted the token (Tranzila echoes
--         it back as `supplier`). Kept because a token is terminal-scoped: the
--         same handle charged on a different terminal is not the same card.
--     All nullable, because every existing row (Grow-era, and there are no
--     paying subscribers on any provider today) legitimately has none of them.
--     `provider` is deliberately left as free-form text with NO CHECK: adding
--     one now would reject whatever a future provider writes and would have to
--     be re-litigated on every provider change.
--
--  2. subscriptions.cancel_at_period_end - the flag that makes "cancel"
--     actually stop the next charge. Until today, /api/billing/cancel wrote
--     app_metadata.plan_cancel_at_period_end and its own comment claimed "the
--     recurring-billing cron reads this flag to stop charging at the period
--     boundary". Nothing read it. Under any self-managed provider (Grow,
--     Tranzila) a cancelled subscriber would have been charged forever. The
--     cron now refuses to charge a row with this flag set (or with the
--     app_metadata flag set) and closes the subscription at the boundary
--     instead.
--
--  3. payment_checkout_intents - one row per checkout, minted server-side
--     BEFORE the customer is sent to Tranzila's hosted page, and consumed by
--     /api/tranzila/notify when the result comes back.
--
--     Why it exists: DirectNG results carry no signature, and no
--     transaction-query endpoint exists in Tranzila's documented API, so the
--     result POST cannot be re-verified server-side today. The intent row is
--     the substitute: its `nonce` travels ONLY on notify_url_address (the
--     server-to-server copy), never on success_url_address, so it never passes
--     through the customer's browser. Identity, tier, interval and the
--     expected amount are read back OUT of this row and never taken from the
--     POST body.
--
--     `nonce` is UNIQUE and `status` starts 'pending'. The notify route
--     consumes it with ONE conditional UPDATE
--     (... WHERE nonce = $1 AND status = 'pending' RETURNING ...), which is
--     atomic in Postgres, so a replay, a duplicated notify and any
--     callback/notify race are structurally impossible rather than merely
--     unlikely. Losing that race returns zero rows and the loser writes
--     nothing.
--
--  4. A partial UNIQUE index on subscription_charge_log (provider,
--     transaction_id). KNOWN RESIDUAL RISK it does NOT solve: the charge-log
--     row is written AFTER the money moves and no idempotency key is sent to
--     Tranzila, so a crash between the two still leaves a real charge with no
--     local record. What the index DOES guarantee is the other direction: one
--     processor transaction can never be credited to two log rows, so a retry
--     that re-reports the same transaction_id is rejected by the database
--     rather than counted twice. There are zero rows in this table today, so
--     the index validates trivially.
--
-- RLS: payment_checkout_intents holds a per-checkout authenticator. RLS ON
-- with NO policies, exactly like subscriptions / subscription_charge_log /
-- tax_authority_credentials: only the service-role client (the checkout route
-- and the notify route) can see it. A client-readable nonce would be a
-- client-readable authenticator.
--
-- APPLY WITH:
--   node scripts/run-sql-file.mjs scripts/migrations/20260923-tranzila-token-persistence.sql
-- ============================================================================

-- ── 1 + 2. subscriptions: card facts + a cancellation flag that is read ─────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS card_exp_month int,
  ADD COLUMN IF NOT EXISTS card_exp_year int,
  ADD COLUMN IF NOT EXISTS card_last4 text,
  ADD COLUMN IF NOT EXISTS provider_terminal text,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subscriptions.card_exp_month IS
  'Card expiry month (1-12) captured with the token. Tranzila token charges require it; a token without an expiry is a data gap, not a decline.';
COMMENT ON COLUMN public.subscriptions.card_exp_year IS
  'Card expiry year, 4 digits. See card_exp_month.';
COMMENT ON COLUMN public.subscriptions.card_last4 IS
  'Last 4 digits of the saved card. Display only.';
COMMENT ON COLUMN public.subscriptions.provider_terminal IS
  'Terminal that minted provider_token. Tokens are terminal-scoped.';
COMMENT ON COLUMN public.subscriptions.cancel_at_period_end IS
  'Set by /api/billing/cancel. The recurring-billing cron refuses to charge a row with this set and closes the subscription at the period boundary.';

-- ── 3. Per-checkout single-use intents ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_checkout_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The single-use authenticator. Minted with crypto.randomBytes(32) and sent
  -- ONLY on notify_url_address. Never logged, never returned to a caller.
  nonce text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Free-form, same reasoning as subscriptions.provider: no CHECK.
  provider text NOT NULL DEFAULT 'tranzila',
  -- What was bought. Read back OUT of this row on notify; never trusted from
  -- the POST body, which anyone who learns the URL could forge.
  tier text NOT NULL,
  interval text NOT NULL CHECK (interval IN ('month', 'year')),
  -- The sum we asked Tranzila to take. The notify route refuses to activate
  -- anything when the echoed sum does not match this to the agora.
  expected_amount numeric(12,2) NOT NULL,
  -- True for a first-time trial checkout (tranmode=N card check, no capture),
  -- which decides trial-vs-paid activation and whether a charge is logged.
  token_only boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed')),
  -- Filled in by the consuming UPDATE, so a consumed intent can be matched
  -- against my.tranzila by hand if a payment is ever disputed.
  transaction_index text,
  transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A checkout the customer abandoned must not stay consumable forever. The
  -- consuming UPDATE also requires expires_at > now().
  -- ('6 hours'::interval, not `interval '6 hours'`: this table has a column
  -- literally named "interval", and the cast form cannot be misread.)
  expires_at timestamptz NOT NULL DEFAULT (now() + '6 hours'::interval),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_payment_checkout_intents_user
  ON public.payment_checkout_intents (user_id);
-- Supports both the consuming UPDATE's predicate and a future cleanup job.
CREATE INDEX IF NOT EXISTS idx_payment_checkout_intents_pending
  ON public.payment_checkout_intents (status, expires_at);

COMMENT ON TABLE public.payment_checkout_intents IS
  'One single-use intent per hosted-page checkout. The nonce travels only on notify_url_address; identity/tier/interval/amount are read from here, never from the result POST.';

-- ── 4. One processor transaction can never be credited twice ────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_subscription_charge_log_provider_txn
  ON public.subscription_charge_log (provider, transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.payment_checkout_intents ENABLE ROW LEVEL SECURITY;

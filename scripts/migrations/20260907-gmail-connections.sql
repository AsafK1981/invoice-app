-- "חבר את Gmail" for הוצאות מהמייל (2026-09-07)
--
-- A second way for invoices to reach the email inbox queue: the owner
-- authorises the app on Google (scope gmail.readonly) and the app pulls
-- attachments straight from Gmail, both for a one-time backfill and on an
-- hourly cron. The queue itself (email_inbox_items) is unchanged; rows just
-- learn where they came from.
--
-- Idempotent: every statement is IF NOT EXISTS / guarded, so re-applying is
-- a no-op. Apply with scripts/run-sql-file.mjs.

-- 1. Where an item came from -------------------------------------------------
--
-- 'resend' is the forwarding address (the Resend inbound webhook), 'gmail'
-- the direct import. Default 'resend' keeps the existing webhook code path
-- valid on a database where this file has not run yet.
ALTER TABLE public.email_inbox_items
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'resend';

ALTER TABLE public.email_inbox_items
  DROP CONSTRAINT IF EXISTS email_inbox_items_origin_check;
ALTER TABLE public.email_inbox_items
  ADD CONSTRAINT email_inbox_items_origin_check
  CHECK (origin IN ('resend', 'gmail'));

-- 2. Connected mail accounts -------------------------------------------------
--
-- One row per (business, provider). The refresh token is stored ENCRYPTED
-- with the app's column key (src/lib/crypto.ts) and is never sent to the
-- browser; the access token is short-lived and never stored at all.
--
-- RLS is ENABLED with ZERO policies: only the service role (the /api/gmail
-- routes and the cron, each of which scopes by business_id after checking
-- the caller) can read or write it. Same posture as email_inbox_items.
CREATE TABLE IF NOT EXISTS public.email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'gmail',
  -- The Google account that granted access, from the id_token.
  email text NOT NULL,
  refresh_token_enc text NOT NULL,
  scope text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  -- Watermark for the hourly incremental sync (mail newer than this).
  last_sync_at timestamptz,
  last_backfill_at timestamptz,
  -- Last problem talking to Google, shown to the owner ('reconnect' etc.).
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_accounts_provider_check CHECK (provider IN ('gmail')),
  CONSTRAINT email_accounts_business_provider_uniq UNIQUE (business_id, provider)
);

ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_accounts FROM PUBLIC;
REVOKE ALL ON TABLE public.email_accounts FROM anon;
REVOKE ALL ON TABLE public.email_accounts FROM authenticated;
GRANT ALL ON TABLE public.email_accounts TO service_role;

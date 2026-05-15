-- Israel Tax Authority "Israel Invoice" OAuth credentials per business.
-- Each עוסק מורשה user that connects gets an access_token + refresh_token
-- scoped to their VAT number. We use these server-side to request
-- invoice allocation numbers from /Invoices/v1/Approval.
--
-- These tokens are highly sensitive (they let us impersonate the
-- business at the Tax Authority). RLS is enabled with no policies —
-- only the service-role client can read or write. Even the owning
-- user can't see their own tokens directly via the supabase JS client.

CREATE TABLE IF NOT EXISTS public.tax_authority_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  vat_number text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS tax_authority_credentials_business_id_idx
  ON public.tax_authority_credentials (business_id);

ALTER TABLE public.tax_authority_credentials ENABLE ROW LEVEL SECURITY;

-- Short-lived state tokens used during the OAuth handshake. The
-- callback verifies the state to defeat CSRF + cross-business redirect
-- forgery. Rows expire 10 minutes after issue.

CREATE TABLE IF NOT EXISTS public.tax_authority_oauth_states (
  state text PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

ALTER TABLE public.tax_authority_oauth_states ENABLE ROW LEVEL SECURITY;

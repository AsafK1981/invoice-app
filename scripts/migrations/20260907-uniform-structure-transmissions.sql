-- Record of every מבנה אחיד file pair sent to רשות המסים.
--
-- From 1.1.2027 a registered vendor must transmit the uniform-structure files
-- as soon as they are produced ("הנחיות בדבר שידור קובץ במבנה אחיד", 3/2026).
-- The transmission is asynchronous on their side: the upload returns only an
-- acknowledgement, and the real verdict (Approved / Rejected, with a reason)
-- has to be fetched later from get-file-status using the per-file identifiers.
-- So the identifiers have to outlive the request that produced them, which is
-- what this table is for. It doubles as the evidence that a given period was
-- filed, and when.
--
-- Server-only, like tax_authority_credentials: RLS is on with no policy, so
-- nothing reaches it except the service role.

CREATE TABLE IF NOT EXISTS public.uniform_structure_transmissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- The period the files cover, as sent in startPeriod / endPeriod.
  period_start date NOT NULL,
  period_end date NOT NULL,

  -- Identifiers returned by GetUrlsForUploadingFiles. `unique_id` groups the
  -- pair; the two file ids are what get-file-status answers about.
  unique_id text,
  ini_file_name text,
  ini_file_unique_id text,
  bkm_file_name text,
  bkm_file_unique_id text,

  -- Our own view of the attempt, distinct from what שע"ם later says about
  -- each file: whether we managed to hand both files over at all.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),

  -- Their verdict per file, refreshed from get-file-status. Empty until the
  -- first poll; "" is what the API itself returns when a file is not found.
  ini_status text,
  bkm_status text,
  rejection_reason text,

  -- Sandbox and production issue independent identifiers, and production was
  -- not yet open when this shipped, so rows must say which world they belong
  -- to or the two become indistinguishable later.
  environment text NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'production')),

  -- Failure detail for our own diagnosis. Never a raw gov.il body, to keep
  -- upstream content out of the database.
  error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz
);

-- The two lookups this table gets: everything for one business, newest first,
-- and "which rows still need their status polled".
CREATE INDEX IF NOT EXISTS uniform_structure_transmissions_business_idx
  ON public.uniform_structure_transmissions (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS uniform_structure_transmissions_pending_idx
  ON public.uniform_structure_transmissions (status, last_checked_at)
  WHERE status = 'sent';

ALTER TABLE public.uniform_structure_transmissions ENABLE ROW LEVEL SECURITY;

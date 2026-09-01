-- Per-business "large text" preference (Asaf, 2026-08-31).
--
-- The sidebar footer gets a "טקסט גדול" switch for people who find the app's
-- text small (older users, low vision). The choice is cached in localStorage
-- for instant paint and stored here so it follows the person to their other
-- devices. Additive, nullable-by-default semantics via DEFAULT 'normal', no
-- backfill needed, no trigger interaction (businesses has no immutability
-- trigger). The existing owner UPDATE policy on businesses already covers
-- the column - the client writes it with the same RLS path as every other
-- business setting.
--
-- Applied to production on 2026-08-31 with scripts/run-sql-file.mjs.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS text_size text NOT NULL DEFAULT 'normal'
  CHECK (text_size IN ('normal', 'large'));

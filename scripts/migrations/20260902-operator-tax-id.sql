-- Operator ת.ז for allocation requests from a חברה בע"מ (2026-09-02).
--
-- The Israel Invoice v2 Approval body carries `user_id`, which the spec
-- defines as the ID of the HUMAN performing the allocation ("תעודת זהות
-- מפעיל השירות"). requestAllocation has always defaulted it to the issuer's
-- own number. For an עוסק מורשה that is correct by coincidence, because a
-- sole trader's עוסק number IS their ת.ז - which is why five allocations
-- have succeeded. For a חברה it sends a ח.פ. where a person's ID belongs,
-- and a company number is not a person.
--
-- This is a real defect independent of error 448, which turned out to mean
-- something else entirely (the issuer's own VAT file is barred from issuing
-- invoices - nothing in our request body). It is stored, not guessed: the
-- number is supplied by the user, and when it is absent the existing
-- behaviour is preserved exactly rather than blocking a company that might
-- otherwise succeed.
--
-- WHY HERE and not on `businesses`: this table is service-role only (RLS
-- enabled, no policies - see tax-authority-credentials.sql), so a personal
-- ID never reaches the browser. `businesses` is read client-side with
-- select("*") by lib/business-store and flows into /api/export-data and the
-- backup zip, so a ת.ז on that table would leak into all three.
--
-- Per-CONNECTION rather than per-business is also the right grain: the ITA
-- semantics are about the human who consented to the OAuth connection, and
-- that is exactly what this row represents.
--
-- Additive and nullable. No backfill: existing sole-trader rows must keep
-- falling back to the issuer number, or they regress with code 446
-- ("Requeried one of the two fields: user ID or user name").
--
-- Applied to production on 2026-09-02 with scripts/run-sql-file.mjs.

ALTER TABLE public.tax_authority_credentials
  ADD COLUMN IF NOT EXISTS operator_tax_id text;

COMMENT ON COLUMN public.tax_authority_credentials.operator_tax_id IS
  'ת.ז of the human who performs allocations for this connection. Sent as the ITA v2 `user_id`. Only meaningful for business_type = company, where the business tax_id is a ח.פ. rather than a person. NULL means fall back to the issuer number, which is correct for a sole trader.';

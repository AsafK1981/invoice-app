-- Secured electronic signature on issued documents (הוראות ניהול ספרים סעיף 1,
-- "מסמך ממוחשב"; חוק חתימה אלקטרונית סעיף 1, "חתימה אלקטרונית מאובטחת").
--
-- Two tables and one private bucket:
--
--   business_signing_keys   one RSA-2048 key + self-signed certificate per
--                           business. The private key is AES-256-GCM encrypted
--                           by the app (src/lib/crypto.ts) before it is stored.
--                           RLS on, NO policies: only the service role reads it.
--   document_signatures     one row per signed document: where the signed
--                           original lives, its SHA-256, when and with which
--                           certificate it was signed. Owners can SELECT their
--                           own rows (the document page shows them); nobody
--                           but the service role writes, and rows never change.
--   signed-documents        private storage bucket for the signed PDFs, path
--                           <business_id>/<document_id>.pdf. No storage
--                           policies: served only through our own routes.
--
-- Nothing here touches public.documents or enforce_document_immutability().
--
-- Apply by hand (NOT applied yet):
--   node scripts/run-sql-file.mjs --reason "secured e-signature: keys, signature records, bucket" scripts/migrations/20260910-document-signatures.sql

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. Per-business signing key ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_signing_keys (
  business_id      uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  private_key_enc  text NOT NULL,
  certificate_pem  text NOT NULL,
  cert_fingerprint text NOT NULL CHECK (cert_fingerprint ~ '^[0-9a-f]{64}$'),
  algorithm        text NOT NULL DEFAULT 'RSA-2048/SHA-256',
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL
);

COMMENT ON TABLE public.business_signing_keys IS
  'Per-business RSA key + self-signed X.509 certificate used to sign issued documents (secured e-signature). private_key_enc is app-encrypted (AES-256-GCM). Service role only.';

ALTER TABLE public.business_signing_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_signing_keys FROM PUBLIC, anon, authenticated;
-- No policies on purpose: with RLS on and no policy, authenticated/anon see
-- nothing even if a grant ever slips back in. The service role bypasses RLS.

-- ── 2. Signature record per document ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_signatures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE CASCADE,
  business_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  storage_path     text NOT NULL,
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  file_size        integer NOT NULL CHECK (file_size > 0),
  signed_at        timestamptz NOT NULL DEFAULT now(),
  algorithm        text NOT NULL,
  cert_fingerprint text NOT NULL CHECK (cert_fingerprint ~ '^[0-9a-f]{64}$'),
  -- Whether the stored file carried the מקור label (first emission) or was
  -- already an העתק when first signed (the original went out by email link
  -- before any PDF was produced).
  is_original      boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.document_signatures IS
  'The signed PDF the app emitted for a document: storage path, SHA-256 of the signed file, signing time and certificate fingerprint. Append-only evidence; written by the service role only.';

CREATE INDEX IF NOT EXISTS document_signatures_business_id_idx
  ON public.document_signatures(business_id);

ALTER TABLE public.document_signatures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_signatures FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.document_signatures FROM authenticated;
GRANT SELECT ON public.document_signatures TO authenticated;

DROP POLICY IF EXISTS "Owners can view own document signatures" ON public.document_signatures;
CREATE POLICY "Owners can view own document signatures" ON public.document_signatures
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid()));

-- A signature record is evidence: it is never edited. Deleting one is allowed
-- only to the service role (account wipe / "delete everything"), and in
-- practice happens through the ON DELETE CASCADE from documents.
CREATE OR REPLACE FUNCTION public.document_signatures_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'document_signatures rows are immutable';
  END IF;
  IF TG_OP = 'DELETE' AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'document_signatures rows cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.document_signatures_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS document_signatures_immutable_trg ON public.document_signatures;
CREATE TRIGGER document_signatures_immutable_trg
  BEFORE UPDATE OR DELETE ON public.document_signatures
  FOR EACH ROW EXECUTE FUNCTION public.document_signatures_immutable();

-- ── 3. Private bucket for the signed files ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('signed-documents', 'signed-documents', false)
ON CONFLICT (id) DO NOTHING;
-- No storage.objects policies: the bucket is reachable only with the service
-- role, i.e. only through /api/documents/[id]/pdf and /api/verify/[id].

COMMIT;

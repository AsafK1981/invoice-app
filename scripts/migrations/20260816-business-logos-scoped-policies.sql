-- ============================================================================
-- business-logos bucket: scope write access to the owning business (2026-08-16)
--
-- Gap: supabase-storage-policies-fix.sql granted
--   FOR ALL TO authenticated USING (bucket_id = 'business-logos')
-- i.e. ANY signed-in user could overwrite or delete ANY other business's
-- logo (upsert:true in business-form-modal.tsx makes overwrite a one-liner).
-- The other private buckets (document-attachments, expense-receipts) were
-- already path-scoped; this one was the outlier.
--
-- Object naming (src/components/business-form-modal.tsx):
--   `${business.id}-${Date.now()}.${ext}`  ->  the first 36 chars of the
--   object name are the owning business UUID. The modal only exists for an
--   already-saved business, so the businesses row is present at upload time.
--
-- New model:
--   SELECT  public   (bucket stays public - logos render on shared documents)
--   INSERT  authenticated, only under a business the caller owns
--   UPDATE  authenticated, only its own objects  (upsert re-upload)
--   DELETE  authenticated, only its own objects
-- Compared as text (left(name,36) IN (...id::text...)) so a malformed name
-- fails the check instead of raising a uuid cast error.
--
-- Idempotent. Apply with: node scripts/run-sql-file.mjs scripts/migrations/20260816-business-logos-scoped-policies.sql
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can manage business-logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own logos"  ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own logos"  ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own logos"  ON storage.objects;
DROP POLICY IF EXISTS "business-logos insert own"         ON storage.objects;
DROP POLICY IF EXISTS "business-logos update own"         ON storage.objects;
DROP POLICY IF EXISTS "business-logos delete own"         ON storage.objects;

CREATE POLICY "business-logos insert own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'business-logos'
  AND left(name, 36) IN (SELECT id::text FROM public.businesses WHERE user_id = auth.uid())
);

CREATE POLICY "business-logos update own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'business-logos'
  AND left(name, 36) IN (SELECT id::text FROM public.businesses WHERE user_id = auth.uid())
)
WITH CHECK (
  bucket_id = 'business-logos'
  AND left(name, 36) IN (SELECT id::text FROM public.businesses WHERE user_id = auth.uid())
);

CREATE POLICY "business-logos delete own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'business-logos'
  AND left(name, 36) IN (SELECT id::text FROM public.businesses WHERE user_id = auth.uid())
);

-- Public read stays as it was (policy "Anyone can read business-logos").
-- Re-create defensively in case it was never applied on this project.
DROP POLICY IF EXISTS "Anyone can read business-logos" ON storage.objects;
CREATE POLICY "Anyone can read business-logos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'business-logos');

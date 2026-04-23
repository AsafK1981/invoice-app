-- Fix storage policies for business-logos bucket
-- Run this in SQL Editor

-- Drop existing policies (if they exist)
DROP POLICY IF EXISTS "Users can upload their own logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own logos" ON storage.objects;

-- Allow authenticated users to do everything in the business-logos bucket
CREATE POLICY "Authenticated users can manage business-logos"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'business-logos')
WITH CHECK (bucket_id = 'business-logos');

-- Allow public read of the bucket contents (since it's a public bucket)
CREATE POLICY "Anyone can read business-logos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'business-logos');

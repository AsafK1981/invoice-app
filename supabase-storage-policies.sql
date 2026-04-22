-- Storage policies for business-logos bucket
-- Run in SQL Editor

-- Allow authenticated users to upload their own logos
CREATE POLICY "Users can upload their own logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'business-logos');

-- Allow authenticated users to update their own logos
CREATE POLICY "Users can update their own logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'business-logos');

-- Allow authenticated users to delete their own logos
CREATE POLICY "Users can delete their own logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'business-logos');

-- P0 SECURITY: drop the over-permissive RLS policies that granted
-- anon read access via USING (true). The public document share link
-- now uses a server-side service-role API route at /api/public-document/[id]
-- so these policies are no longer needed.

DROP POLICY IF EXISTS "Public can view business info for documents" ON businesses;
DROP POLICY IF EXISTS "Public can view client info for documents" ON clients;
DROP POLICY IF EXISTS "Public can view documents by ID" ON documents;
DROP POLICY IF EXISTS "Public can view document items" ON document_items;

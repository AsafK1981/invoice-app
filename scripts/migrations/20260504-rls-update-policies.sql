-- Add missing RLS UPDATE policies on documents and document_items.
--
-- Symptom: clicking "סמן כשולם" (the Circle icon in the documents list)
-- registered the click but did nothing visible. Same for markDocumentEmailed
-- after a successful send. Root cause: PostgREST honors RLS, and there was
-- no UPDATE policy on these tables — the request returned 0 rows affected
-- with no error, so the UI had no way to detect the silent failure.
--
-- Why both tables: when the editor saves changes to an existing doc it
-- updates the document AND its line items. The latter would silently fail
-- in the same way the moment we wired up edit (we'd have shipped a feature
-- that looked like it worked).
--
-- Detected 2026-05-04 from a real "click does nothing" bug report.

CREATE POLICY "Users can update own documents" ON documents
  FOR UPDATE
  USING (
    business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())
  )
  WITH CHECK (
    business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own document items" ON document_items
  FOR UPDATE
  USING (
    document_id IN (
      SELECT documents.id
      FROM documents
      JOIN businesses ON documents.business_id = businesses.id
      WHERE businesses.user_id = auth.uid()
    )
  )
  WITH CHECK (
    document_id IN (
      SELECT documents.id
      FROM documents
      JOIN businesses ON documents.business_id = businesses.id
      WHERE businesses.user_id = auth.uid()
    )
  );

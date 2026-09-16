-- Raise a business's document counter, atomically, in one statement.
--
-- Context: the three import paths each hand-rolled "read the counter, compare,
-- then update or insert". Every one of them dropped its errors, and the read
-- failed open - under RLS a request that loses its access token is answered
-- with zero rows and no error - so the counter could silently stay behind a
-- number the import had just written. The next live document then gets a
-- number that already exists.
--
-- The client-side rewrite that replaced it (a conditional UPDATE, then an
-- INSERT, retrying on 23505) was closer, but it is still two statements, and
-- the coding council kept producing interleavings that beat it. The decisive
-- one is not exotic: src/components/document-numbering-settings.tsx lets the
-- owner set the next number BY HAND, including to a lower value, so "the row
-- exists and my UPDATE declined to raise it, therefore it is high enough" is
-- simply not a fact the client can establish. Any multi-statement version has
-- to reason about interleavings; this one does not have to.
--
-- GREATEST inside ON CONFLICT DO UPDATE makes it a single atomic statement
-- that can only ever RAISE the counter. There is no read, no comparison in
-- application code, and no retry.
--
-- SECURITY INVOKER (the default): the function runs as the caller, so the RLS
-- policies on document_counters - business_id must belong to auth.uid()'s
-- business - still apply exactly as they did for the direct writes this
-- replaces. It grants nobody anything they did not already have; it only makes
-- the operation atomic. The grants below still follow the project rule of
-- revoking PUBLIC and naming the roles explicitly.

CREATE OR REPLACE FUNCTION public.bump_document_counter(
  p_business_id uuid,
  p_doc_type    text,
  p_target      integer
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.document_counters (business_id, doc_type, next_number)
  VALUES (p_business_id, p_doc_type, p_target)
  ON CONFLICT (business_id, doc_type)
  DO UPDATE SET next_number = GREATEST(public.document_counters.next_number, EXCLUDED.next_number);
$$;

REVOKE ALL ON FUNCTION public.bump_document_counter(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_document_counter(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.bump_document_counter(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bump_document_counter(uuid, text, integer) TO service_role;

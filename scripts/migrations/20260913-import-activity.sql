-- Additive metadata only. Apply before releasing code that stamps imports.
BEGIN;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS import_batch_id uuid;

-- Invoker rights are essential: a definer would always see the owner's role.
CREATE OR REPLACE FUNCTION public.guard_import_batch_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Import provenance cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_import_batch_metadata() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE entity text;
BEGIN
  FOREACH entity IN ARRAY ARRAY['documents', 'clients', 'expenses', 'products'] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (business_id, import_batch_id, created_at) WHERE import_batch_id IS NOT NULL', entity || '_import_batch_idx', entity);
    EXECUTE format('DROP TRIGGER IF EXISTS guard_import_batch_metadata ON public.%I', entity);
    EXECUTE format('CREATE TRIGGER guard_import_batch_metadata BEFORE UPDATE OF import_batch_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_import_batch_metadata()', entity);
  END LOOP;
END;
$$;

-- Aggregate actual persisted rows before any API limit. No tenant content.
CREATE OR REPLACE VIEW public.admin_import_activity WITH (security_invoker = true) AS
SELECT business_id, import_batch_id,
       min(created_at) AS first_created_at, max(created_at) AS last_created_at,
       count(*) FILTER (WHERE entity = 'documents') AS document_count,
       count(*) FILTER (WHERE entity = 'clients') AS client_count,
       count(*) FILTER (WHERE entity = 'expenses') AS expense_count,
       count(*) FILTER (WHERE entity = 'products') AS product_count
FROM (
  SELECT business_id, import_batch_id, created_at, 'documents' AS entity FROM public.documents WHERE import_batch_id IS NOT NULL
  UNION ALL
  SELECT business_id, import_batch_id, created_at, 'clients' AS entity FROM public.clients WHERE import_batch_id IS NOT NULL
  UNION ALL
  SELECT business_id, import_batch_id, created_at, 'expenses' AS entity FROM public.expenses WHERE import_batch_id IS NOT NULL
  UNION ALL
  SELECT business_id, import_batch_id, created_at, 'products' AS entity FROM public.products WHERE import_batch_id IS NOT NULL
) AS imported
GROUP BY business_id, import_batch_id;
REVOKE ALL ON public.admin_import_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_import_activity TO service_role;

-- Eligible payment actions must be filtered before the route's source cap.
CREATE OR REPLACE VIEW public.admin_paid_document_activity WITH (security_invoker = true) AS
SELECT id, business_id, type, status, created_at, emailed_at, paid_at, import_batch_id
FROM public.documents
WHERE paid_at IS NOT NULL AND (
  (import_batch_id IS NULL AND abs(extract(epoch FROM (paid_at - created_at))) > 60)
  OR (import_batch_id IS NOT NULL AND paid_at > created_at + interval '60 seconds')
);
REVOKE ALL ON public.admin_paid_document_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_paid_document_activity TO service_role;
COMMIT;

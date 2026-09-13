-- Operator metadata only. Apply before deploying the paginated activity API.
BEGIN;
-- The invoker view needs only these auth metadata columns.
GRANT SELECT (id, email, last_sign_in_at) ON auth.users TO service_role;
CREATE OR REPLACE VIEW public.admin_activity_events WITH (security_invoker = true) AS
WITH primary_business AS (
  SELECT DISTINCT ON (user_id) user_id, id FROM public.businesses ORDER BY user_id, created_at, id
), events AS (
  SELECT 'document.created:' || id AS event_id, created_at AS at, 'document.created' AS kind,
    business_id, type::text AS document_type, status = 'draft' AS draft,
    0::bigint AS document_count, 0::bigint AS client_count, 0::bigint AS expense_count, 0::bigint AS product_count,
    NULL::uuid AS user_id
  FROM public.documents WHERE import_batch_id IS NULL
  UNION ALL
  SELECT 'document.emailed:' || id, emailed_at, 'document.emailed', business_id, type::text, NULL, 0, 0, 0, 0, NULL
  FROM public.documents WHERE emailed_at IS NOT NULL
  UNION ALL
  SELECT 'document.paid:' || id, paid_at, 'document.paid', business_id, type::text, NULL, 0, 0, 0, 0, NULL
  FROM public.admin_paid_document_activity
  UNION ALL
  SELECT 'expense.created:' || id, created_at, 'expense.created', business_id, NULL, NULL, 0, 0, 0, 0, NULL
  FROM public.expenses WHERE import_batch_id IS NULL
  UNION ALL
  SELECT 'client.created:' || id, created_at, 'client.created', business_id, NULL, NULL, 0, 0, 0, 0, NULL
  FROM public.clients WHERE import_batch_id IS NULL
  UNION ALL
  SELECT 'data.imported:' || business_id || ':' || import_batch_id, last_created_at, 'data.imported', business_id, NULL, NULL,
    document_count, client_count, expense_count, product_count, NULL
  FROM public.admin_import_activity
  UNION ALL
  -- auth.users retains the most recent sign-in, not a historical login journal.
  SELECT 'user.signed_in:' || u.id, u.last_sign_in_at, 'user.signed_in', p.id, NULL, NULL, 0, 0, 0, 0, u.id
  FROM auth.users u LEFT JOIN primary_business p ON p.user_id = u.id WHERE u.last_sign_in_at IS NOT NULL
)
SELECT e.event_id, e.at, e.kind, u.email::text AS email,
  NULLIF(btrim(b.name), '') AS business_name, e.document_type, e.draft,
  e.document_count, e.client_count, e.expense_count, e.product_count
FROM events e
LEFT JOIN public.businesses b ON b.id = e.business_id
LEFT JOIN auth.users u ON u.id = COALESCE(e.user_id, b.user_id)
WHERE e.at IS NOT NULL;
REVOKE ALL ON public.admin_activity_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_activity_events TO service_role;

-- Aggregate before API row limits. UTC dates match the existing chart buckets.
CREATE OR REPLACE VIEW public.admin_document_creation_daily WITH (security_invoker = true) AS
SELECT (created_at AT TIME ZONE 'UTC')::date AS day, type::text AS type,
  count(*) AS document_count,
  count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS document_count_30d,
  count(*) FILTER (WHERE status = 'draft' AND created_at >= now() - interval '30 days') AS draft_count_30d
FROM public.documents WHERE import_batch_id IS NULL
GROUP BY (created_at AT TIME ZONE 'UTC')::date, type;
REVOKE ALL ON public.admin_document_creation_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_document_creation_daily TO service_role;
COMMIT;

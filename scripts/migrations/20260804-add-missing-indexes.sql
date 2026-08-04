-- 20260804-add-missing-indexes.sql
--
-- WHY
-- clients, products, expenses, and document_items currently have no index
-- besides their primary key. Every list-page filter (business_id scoping,
-- expense date-range, pulling a document's line items) is a sequential
-- scan that gets slower as each table grows. documents already had some
-- coverage reviewed here too; add the two composite indexes its own list
-- page and dashboard status filters need (business_id+date, and the
-- business_id+status partial index for the "sent"/"paid" follow-up views).
--
-- CONCURRENTLY cannot run inside a transaction block (Postgres rejects
-- `CREATE INDEX CONCURRENTLY` inside BEGIN/COMMIT). Apply each statement
-- below ONE AT A TIME, not as a single multi-statement transaction, via
-- scripts/run-sql.mjs or the Supabase SQL editor with "autocommit" per
-- statement. IF NOT EXISTS makes every statement safely re-runnable if an
-- earlier one in the batch failed partway through.
--
-- NOT executed by this file or by any agent. Written for manual/records
-- application only, per project instructions.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_business_id ON public.clients (business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_business_id ON public.products (business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_business_id_date ON public.expenses (business_id, date DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_items_document_id ON public.document_items (document_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_business_id_date ON public.documents (business_id, date DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_business_id_status ON public.documents (business_id, status) WHERE status IN ('sent','paid');

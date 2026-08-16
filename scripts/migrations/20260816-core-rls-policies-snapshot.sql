-- ============================================================================
-- Core-table RLS policies - tracked snapshot of PRODUCTION (2026-08-16)
--
-- The owner-scoped SELECT / INSERT / DELETE policies on the seven core tables
-- (and the UPDATE policies for five of them) were applied to the live
-- project by hand in April/May 2026 and never committed; only
-- 20260504-rls-update-policies.sql (documents + document_items UPDATE) is in
-- the repo. Every council seat on 2026-08-16 flagged the same thing: a
-- project rebuilt from tracked migrations would come up without these
-- policies. This file is a verbatim export from pg_policies on the live
-- project (generated with a format() query over pg_policies, then reviewed),
-- made idempotent with DROP POLICY IF EXISTS.
--
-- Semantics (all PERMISSIVE, all TO public - anon evaluates auth.uid() to
-- NULL and therefore matches nothing):
--   businesses         owner = user_id = auth.uid()          (no DELETE policy:
--                      account wipes go through the service role on purpose)
--   clients, products, expenses, document_counters, documents
--                      business_id IN (owner's businesses)
--   document_items     document_id IN (documents of owner's businesses)
--
-- Re-running this on production is a no-op in effect (same definitions).
-- Apply with: node scripts/run-sql-file.mjs scripts/migrations/20260816-core-rls-policies-snapshot.sql
-- ============================================================================

-- businesses ---------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert own businesses" ON public.businesses;
CREATE POLICY "Users can insert own businesses" ON public.businesses FOR INSERT TO public
  WITH CHECK ((user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can view own businesses" ON public.businesses;
CREATE POLICY "Users can view own businesses" ON public.businesses FOR SELECT TO public
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can update own businesses" ON public.businesses;
CREATE POLICY "Users can update own businesses" ON public.businesses FOR UPDATE TO public
  USING ((user_id = auth.uid()));

-- clients ------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can delete own clients" ON public.clients;
CREATE POLICY "Users can delete own clients" ON public.clients FOR DELETE TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can insert own clients" ON public.clients;
CREATE POLICY "Users can insert own clients" ON public.clients FOR INSERT TO public
  WITH CHECK ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can view own clients" ON public.clients;
CREATE POLICY "Users can view own clients" ON public.clients FOR SELECT TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can update own clients" ON public.clients;
CREATE POLICY "Users can update own clients" ON public.clients FOR UPDATE TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

-- document_counters --------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert own counters" ON public.document_counters;
CREATE POLICY "Users can insert own counters" ON public.document_counters FOR INSERT TO public
  WITH CHECK ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can view own counters" ON public.document_counters;
CREATE POLICY "Users can view own counters" ON public.document_counters FOR SELECT TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can update own counters" ON public.document_counters;
CREATE POLICY "Users can update own counters" ON public.document_counters FOR UPDATE TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

-- document_items -----------------------------------------------------------
DROP POLICY IF EXISTS "Users can delete own document items" ON public.document_items;
CREATE POLICY "Users can delete own document items" ON public.document_items FOR DELETE TO public
  USING ((document_id IN ( SELECT documents.id FROM documents
    WHERE (documents.business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))))));
DROP POLICY IF EXISTS "Users can insert own document items" ON public.document_items;
CREATE POLICY "Users can insert own document items" ON public.document_items FOR INSERT TO public
  WITH CHECK ((document_id IN ( SELECT documents.id FROM documents
    WHERE (documents.business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))))));
DROP POLICY IF EXISTS "Users can view own document items" ON public.document_items;
CREATE POLICY "Users can view own document items" ON public.document_items FOR SELECT TO public
  USING ((document_id IN ( SELECT documents.id FROM documents
    WHERE (documents.business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))))));
DROP POLICY IF EXISTS "Users can update own document items" ON public.document_items;
CREATE POLICY "Users can update own document items" ON public.document_items FOR UPDATE TO public
  USING ((document_id IN ( SELECT documents.id FROM (documents JOIN businesses ON ((documents.business_id = businesses.id)))
    WHERE (businesses.user_id = auth.uid()))))
  WITH CHECK ((document_id IN ( SELECT documents.id FROM (documents JOIN businesses ON ((documents.business_id = businesses.id)))
    WHERE (businesses.user_id = auth.uid()))));

-- documents ----------------------------------------------------------------
DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
CREATE POLICY "Users can delete own documents" ON public.documents FOR DELETE TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
CREATE POLICY "Users can insert own documents" ON public.documents FOR INSERT TO public
  WITH CHECK ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can view own documents" ON public.documents;
CREATE POLICY "Users can view own documents" ON public.documents FOR SELECT TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can update own documents" ON public.documents;
CREATE POLICY "Users can update own documents" ON public.documents FOR UPDATE TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))))
  WITH CHECK ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

-- expenses -----------------------------------------------------------------
DROP POLICY IF EXISTS "Users can delete own expenses" ON public.expenses;
CREATE POLICY "Users can delete own expenses" ON public.expenses FOR DELETE TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can insert own expenses" ON public.expenses;
CREATE POLICY "Users can insert own expenses" ON public.expenses FOR INSERT TO public
  WITH CHECK ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can view own expenses" ON public.expenses;
CREATE POLICY "Users can view own expenses" ON public.expenses FOR SELECT TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can update own expenses" ON public.expenses;
CREATE POLICY "Users can update own expenses" ON public.expenses FOR UPDATE TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

-- products -----------------------------------------------------------------
DROP POLICY IF EXISTS "Users can delete own products" ON public.products;
CREATE POLICY "Users can delete own products" ON public.products FOR DELETE TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can insert own products" ON public.products;
CREATE POLICY "Users can insert own products" ON public.products FOR INSERT TO public
  WITH CHECK ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can view own products" ON public.products;
CREATE POLICY "Users can view own products" ON public.products FOR SELECT TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));
DROP POLICY IF EXISTS "Users can update own products" ON public.products;
CREATE POLICY "Users can update own products" ON public.products FOR UPDATE TO public
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

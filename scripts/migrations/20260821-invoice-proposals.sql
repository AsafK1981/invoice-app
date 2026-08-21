-- ============================================================================
-- invoice_proposals (2026-08-21)
--
-- A proposal is a document an automation WANTS to issue, waiting for the
-- owner's approval. It is deliberately NOT a draft `documents` row:
--
--   create_document_atomic() allocates the document number at INSERT time,
--   including for drafts. If an automation created a draft every month and
--   the owner rejected one, the counter would have advanced and the issued
--   sequence would carry a gap - exactly what רשות המסים does not accept.
--   So the pending state lives here, numberless, and the real document is
--   created through the normal path only when the owner presses "approve".
--
-- The row is also the dedupe key: UNIQUE (business_id, source, period) means
-- an automation that runs twice (retry, a manual re-run, a second machine)
-- updates its own pending proposal instead of stacking duplicates. Once the
-- proposal is approved or dismissed the refresh must NOT resurrect it: the
-- API route's UPDATE carries `.eq("status", "pending")` so a resolved row
-- matches nothing and the caller gets a 409. That predicate lives in the
-- route rather than in an ON CONFLICT clause because ON CONFLICT DO UPDATE
-- cannot filter on the existing row's status without also swallowing the
-- "already resolved" signal the caller needs to see.
--
-- The same conditional-update pattern guards approval on the client side
-- (src/lib/proposal-store.ts claimProposal): the proposal is claimed BEFORE
-- the document is created, so two racing approvals cannot both issue.
--
-- RLS: an owner reads/updates/deletes only their own proposals. There is
-- deliberately NO INSERT policy for `authenticated` - proposals are written
-- by /api/proposals with the service role after a shared-secret check. A
-- browser session cannot mint a proposal for itself (nothing would break if
-- it could, but the narrower grant keeps the write path to exactly one).
--
-- Idempotent. Apply with:
--   node scripts/run-sql-file.mjs scripts/migrations/20260821-invoice-proposals.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoice_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Which automation produced this. Free text so a second source can be added
  -- without a migration; the UI shows source_label, not this.
  source text NOT NULL,
  source_label text NOT NULL DEFAULT '',

  -- The billing period this covers, 'YYYY-MM'. Part of the dedupe key.
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),

  document_type text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  client_name text NOT NULL,
  subject text NOT NULL,

  -- [{ description, quantity, unitPrice, total }] - the proposed lines,
  -- exactly the shape the editor and create_document_atomic consume.
  items jsonb NOT NULL,
  total numeric(14,2) NOT NULL,

  -- Free-form evidence from the source (for the גיגים: date + venue per row)
  -- so the owner can verify the numbers before approving. Display only.
  details jsonb,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'dismissed')),

  -- Set when status becomes 'approved': the document that was actually issued.
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,

  CONSTRAINT invoice_proposals_unique_period UNIQUE (business_id, source, period)
);

-- The dashboard's only query: pending proposals for my business, newest first.
CREATE INDEX IF NOT EXISTS invoice_proposals_pending_idx
  ON invoice_proposals (business_id, status, created_at DESC);

ALTER TABLE invoice_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own proposals" ON invoice_proposals;
CREATE POLICY "Users can view own proposals" ON invoice_proposals
  FOR SELECT
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

DROP POLICY IF EXISTS "Users can update own proposals" ON invoice_proposals;
CREATE POLICY "Users can update own proposals" ON invoice_proposals
  FOR UPDATE
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))))
  WITH CHECK ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

DROP POLICY IF EXISTS "Users can delete own proposals" ON invoice_proposals;
CREATE POLICY "Users can delete own proposals" ON invoice_proposals
  FOR DELETE
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

-- No INSERT policy on purpose: see the header comment.

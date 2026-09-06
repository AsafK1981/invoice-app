-- ============================================================================
-- Expenses from email - inbound forwarding address (2026-09-06)
--
-- Each business can turn on a personal forwarding address
-- (<token>@friendlyinvoice.co.il). Mail sent there arrives on Resend's
-- inbound webhook (`email.received`), each supported attachment is downloaded,
-- scanned by the same OCR the manual scanner uses, and parked in
-- `email_inbox_items` as a PENDING item. Nothing is ever written to `expenses`
-- without the owner pressing approve in the app: an expense feeds the VAT
-- return and the income tax books, so a misread number must never enter them
-- unattended.
--
-- Four parts:
--   businesses.inbox_token / inbox_enabled  the address and its on/off switch
--   expenses.source / source_ref            provenance + cross-channel dedupe
--   email_inbox_items                       the pending queue (service role only)
--   email_inbox_approve()                   the atomic approve step
--
-- TRANSACTION: scripts/run-sql-file.mjs sends the whole file as ONE statement
-- string, which Postgres runs in a single implicit transaction - so this file
-- either applies completely or not at all. That is only affordable because
-- every table it touches is small: the ALTERs take brief ACCESS EXCLUSIVE
-- locks on `businesses` and `expenses`, and on a table with millions of rows
-- the ADD COLUMN ... NOT NULL DEFAULT lines would want splitting up. They are
-- not that big here.
--
-- Idempotent: safe to re-apply. Apply with:
--   node scripts/run-sql-file.mjs --reason "email inbox" scripts/migrations/20260906-email-inbox.sql
-- ============================================================================

-- 1. businesses: the forwarding address ------------------------------------
--
-- inbox_token is the ENTIRE secret of this channel: anyone who knows it can
-- drop a receipt into the owner's pending queue. It is therefore random,
-- rotatable (the app just writes a new one), and UNIQUE so a token can never
-- resolve to two businesses. inbox_enabled defaults false: an account that
-- never opted in has no address at all, and the webhook drops mail for a
-- disabled token exactly like an unknown one.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS inbox_token text,
  ADD COLUMN IF NOT EXISTS inbox_enabled boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS businesses_inbox_token_key
  ON public.businesses (inbox_token)
  WHERE inbox_token IS NOT NULL;

-- 2. expenses: where a row came from ---------------------------------------
--
-- source defaults to 'manual' so every existing row keeps its meaning without
-- a backfill. source_ref holds the channel's own identifier for the evidence -
-- for email that is `<Message-ID>#<attachment index>`, because one mail can
-- carry several receipts and each becomes its own expense. The partial unique
-- index is the real dedupe guarantee: forward the same mail twice, approve it
-- twice, or let a webhook retry replay - only one expense can ever exist for
-- one source_ref within one business. NULL source_ref (every manual row) is
-- excluded, so manual entry is unaffected.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_ref text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expenses_source_check'
      AND conrelid = 'public.expenses'::regclass
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_source_check
      CHECK (source IN ('manual', 'scan', 'whatsapp', 'email'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_business_source_ref_key
  ON public.expenses (business_id, source_ref)
  WHERE source_ref IS NOT NULL;

-- 3. email_inbox_items: the pending queue -----------------------------------
--
-- One row per ATTACHMENT (not per mail), created BEFORE anything expensive
-- happens (the download and the OCR call). That ordering is deliberate: the
-- UNIQUE (business_id, message_id, attachment_index) below is what stops a
-- webhook retry from paying for a second scan of an attachment already in
-- flight. Resend redelivers until it gets a 2xx, and a slow-but-successful
-- run is redelivered too.
--
-- message_id is the forwarded mail's own Message-ID header. When a sender
-- omits it the route falls back to the Resend email_id, which is always
-- present - so this column is NOT NULL and always carries a usable key.
--
-- attachment_index is the position among the SUPPORTED attachments, in the
-- order Resend lists them. Stable across redeliveries of the same mail, which
-- is what makes `<message_id>#<attachment_index>` a safe expenses.source_ref.
--
-- attachment_sha256 is the hash of the downloaded bytes. It catches the case
-- the message id cannot: the owner forwards the SAME receipt a second time
-- from a different mail. Such an item is failed with reason 'duplicate'
-- before any quota is charged.
--
-- scan holds the raw ScanFields object (vendor / amount / vatAmount / date /
-- category / description / unreadFields / legibility / documentKind). It is a
-- proposal, not a fact: the approve step re-reads the owner's edited values.
--
-- status:
--   processing  claimed by a webhook run; NOT shown in the app. A row stuck
--               here for more than 3 minutes is re-claimable (the run died).
--   pending     scanned, waiting for the owner
--   approved    turned into an expense (expense_id points at it)
--   rejected    the owner threw it away (the stored object is deleted too)
--   failed      never reached the owner - reason says why (no_attachment,
--               too_large, quota, rate_limited, download_failed, not_expense,
--               unreadable, duplicate, too_many, gmail_verification, error)
--
-- A failed row whose reason is transient (rate_limited, download_failed,
-- error, quota) is re-claimable too, so a redelivery or a re-forward retries
-- it instead of leaving the owner with a dead card.
--
-- gmail_verification is not a failure the owner did anything wrong: it is the
-- confirmation mail Gmail sends when someone points a forwarding rule at their
-- inbox address. `detail` then carries the confirmation link, so the app can
-- offer a button instead of asking the owner to dig the mail out of a mailbox
-- that just forwarded it away. (`detail` also carries the older item's id for
-- 'duplicate', and the attachment count for 'too_many'.)
--
-- RLS is ENABLED with ZERO policies: that denies anon and authenticated
-- outright and leaves only the service-role key (the webhook and the
-- /api/email-inbox routes, both of which scope every query by business_id
-- after checking the caller's session). Same posture as whatsapp_processed
-- and expense_scan_usage. Per AGENTS.md this project never ships a public
-- policy with USING (true).

CREATE TABLE IF NOT EXISTS public.email_inbox_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- Resend's id for the received mail; the key for its Receiving API.
  email_id text NOT NULL,
  -- The mail's Message-ID (or email_id as fallback). Dedupe key.
  message_id text NOT NULL,
  -- Position among the supported attachments of that mail.
  attachment_index integer NOT NULL DEFAULT 0,

  from_address text,
  subject text,
  received_at timestamptz NOT NULL DEFAULT now(),

  attachment_name text,
  attachment_type text,
  attachment_sha256 text,
  -- Path in the private `expense-receipts` bucket, `<auth user id>/<uuid>.<ext>`.
  receipt_path text,

  scan jsonb,

  status text NOT NULL DEFAULT 'processing',
  reason text,
  -- Free-form companion to `reason`: the Gmail confirmation URL, the older
  -- item's id for a duplicate, the attachment count for too_many. Never
  -- rendered as HTML, only as text or a re-validated link.
  detail text,
  -- When the current 'processing' claim was taken. Drives the stale-claim
  -- takeover; NULL on every row that is not being processed right now.
  processing_started_at timestamptz,

  expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,

  CONSTRAINT email_inbox_items_message_attachment_uniq
    UNIQUE (business_id, message_id, attachment_index)
);

-- Re-run safety: CREATE TABLE IF NOT EXISTS is a no-op on a table created by
-- an earlier version of this file, so any column added after the first apply
-- needs its own ADD COLUMN IF NOT EXISTS.
ALTER TABLE public.email_inbox_items
  ADD COLUMN IF NOT EXISTS detail text,
  ADD COLUMN IF NOT EXISTS attachment_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_sha256 text,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

-- The status vocabulary gained 'processing' after the first draft of this
-- file. DROP + ADD rather than a NOT EXISTS guard, so a database still
-- carrying the older four-value CHECK is upgraded rather than left behind.
ALTER TABLE public.email_inbox_items
  DROP CONSTRAINT IF EXISTS email_inbox_items_status_check;
ALTER TABLE public.email_inbox_items
  ADD CONSTRAINT email_inbox_items_status_check
  CHECK (status IN ('processing', 'pending', 'approved', 'rejected', 'failed'));

-- The dedupe key gained attachment_index at the same time; drop the old
-- one-row-per-mail constraint if a previous apply created it.
ALTER TABLE public.email_inbox_items
  DROP CONSTRAINT IF EXISTS email_inbox_items_message_uniq;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_inbox_items_message_attachment_uniq'
      AND conrelid = 'public.email_inbox_items'::regclass
  ) THEN
    ALTER TABLE public.email_inbox_items
      ADD CONSTRAINT email_inbox_items_message_attachment_uniq
      UNIQUE (business_id, message_id, attachment_index);
  END IF;
END
$$;

-- The app's only query: my business's items by state, newest first.
CREATE INDEX IF NOT EXISTS email_inbox_items_business_status_idx
  ON public.email_inbox_items (business_id, status, created_at DESC);

-- The re-forward guard: "has this business already got this exact file?"
CREATE INDEX IF NOT EXISTS email_inbox_items_business_sha_idx
  ON public.email_inbox_items (business_id, attachment_sha256)
  WHERE attachment_sha256 IS NOT NULL;

ALTER TABLE public.email_inbox_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_inbox_items FROM PUBLIC;
REVOKE ALL ON TABLE public.email_inbox_items FROM anon;
REVOKE ALL ON TABLE public.email_inbox_items FROM authenticated;
GRANT ALL ON TABLE public.email_inbox_items TO service_role;

-- 4. email_inbox_approve: the one write into the books ----------------------
--
-- Approve used to be four round trips from the API route (read, claim, insert,
-- link). Two tabs, a double tap or a retried fetch could interleave them, and
-- a failure between the claim and the insert left an item marked approved with
-- no expense behind it. This function does the whole thing under one row lock
-- inside one transaction:
--
--   * SELECT ... FOR UPDATE serialises concurrent approvals of the same item.
--   * Already approved -> return the expense id that exists. Idempotent.
--   * Any other non-pending status -> P0001 'not_pending', which the route
--     turns into 409.
--   * ON CONFLICT DO NOTHING on the partial unique index means an expense
--     already booked for this (business, source_ref) is adopted instead of
--     duplicated - the books can never gain a second copy of one receipt.
--
-- The column list mirrors exactly what expenseStore.save() writes, so a row
-- approved from the mail queue is indistinguishable from a hand-typed one.
--
-- SECURITY DEFINER because `email_inbox_items` has RLS with zero policies.
-- Per AGENTS.md every SECURITY DEFINER function here is locked to
-- service_role: the API route already proved the caller owns p_business.

CREATE OR REPLACE FUNCTION public.email_inbox_approve(
  p_item uuid,
  p_business uuid,
  p_expense jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_item public.email_inbox_items%ROWTYPE;
  v_source_ref text;
  v_expense_id uuid;
BEGIN
  SELECT * INTO v_item
  FROM public.email_inbox_items
  WHERE id = p_item AND business_id = p_business
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_item.status = 'approved' THEN
    RETURN v_item.expense_id;
  END IF;

  IF v_item.status <> 'pending' THEN
    RAISE EXCEPTION 'not_pending' USING ERRCODE = 'P0001';
  END IF;

  v_source_ref := v_item.message_id || '#' || v_item.attachment_index;

  INSERT INTO public.expenses (
    business_id, date, category, supplier, amount, vat_amount, description,
    supplier_tax_id, reference, is_equipment, allocation_number, receipt_path,
    source, source_ref
  )
  VALUES (
    p_business,
    (p_expense->>'date')::date,
    p_expense->>'category',
    p_expense->>'supplier',
    (p_expense->>'amount')::numeric,
    COALESCE((p_expense->>'vatAmount')::numeric, 0),
    NULLIF(p_expense->>'description', ''),
    NULLIF(p_expense->>'supplierTaxId', ''),
    NULLIF(p_expense->>'reference', ''),
    COALESCE((p_expense->>'isEquipment')::boolean, false),
    NULLIF(p_expense->>'allocationNumber', ''),
    v_item.receipt_path,
    'email',
    v_source_ref
  )
  ON CONFLICT (business_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING
  RETURNING id INTO v_expense_id;

  -- DO NOTHING returns no row: this receipt is already in the books from an
  -- earlier item. Point at that expense rather than inventing a second one.
  IF v_expense_id IS NULL THEN
    SELECT id INTO v_expense_id
    FROM public.expenses
    WHERE business_id = p_business AND source_ref = v_source_ref;
  END IF;

  UPDATE public.email_inbox_items
  SET status = 'approved',
      expense_id = v_expense_id,
      processing_started_at = NULL,
      resolved_at = now()
  WHERE id = p_item;

  RETURN v_expense_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.email_inbox_approve(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_inbox_approve(uuid, uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_inbox_approve(uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.email_inbox_approve(uuid, uuid, jsonb) TO service_role;

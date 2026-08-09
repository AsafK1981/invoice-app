-- WhatsApp channel (2026-08-08)
--
-- Lets a user issue documents and log expenses by chatting with the app's
-- WhatsApp number, without opening the app. Everything here is server-side and
-- service-role only: the bot has no browser session, so nothing in this file may
-- rely on auth.uid().
--
-- Five tables + one RPC:
--   whatsapp_identities        phone -> (user_id, business_id) binding
--   whatsapp_link_codes        one-time codes that create that binding
--   whatsapp_pending_actions   the DRAFT a user must confirm before we write
--   whatsapp_processed         inbound message-id dedupe (Meta retries webhooks)
--   whatsapp_usage             per-user monthly action cap (cost ceiling)
--   create_document_for_bot()  the ONLY way the bot may write a document
--
-- APPLY THIS FILE AS ONE QUERY (scripts/run-sql.mjs sends the whole file in a
-- single request, which Postgres runs in one implicit transaction). Splitting it
-- into per-statement calls would leave each SECURITY DEFINER function carrying
-- Postgres's default PUBLIC execute grant for the gap between its CREATE and the
-- REVOKE further down.
--
-- All five tables get RLS enabled with ZERO policies: that denies anon and
-- authenticated outright, leaving only the service-role key (the webhook route).
-- Same posture as document_counters and expense_scan_usage. Per AGENTS.md this
-- project never ships a public policy with USING (true).

-- ── 1. identity binding ──────────────────────────────────────────────────────
-- phone is the E.164 digits WITHOUT a leading '+', exactly as Meta delivers it
-- in `messages[].from` (e.g. '972549000684'). Storing Meta's own format avoids a
-- normalisation bug becoming an authentication bug.

CREATE TABLE IF NOT EXISTS whatsapp_identities (
  phone           text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz
);

-- One phone per user and one user per phone. Without this a second link code
-- could silently point a user's phone at a different business.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_identities_user_uniq
  ON whatsapp_identities (user_id);

ALTER TABLE whatsapp_identities ENABLE ROW LEVEL SECURITY;

-- ── 2. one-time link codes ───────────────────────────────────────────────────
-- Minted by an authenticated app route, redeemed by sending the code to the bot.
-- Short-lived and single-use: the code IS the proof of ownership, so a long TTL
-- or a reusable code would let anyone who sees it bind their phone to the
-- account.

CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
  code        text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  used_by     text
);

CREATE INDEX IF NOT EXISTS whatsapp_link_codes_user_idx
  ON whatsapp_link_codes (user_id, created_at DESC);

ALTER TABLE whatsapp_link_codes ENABLE ROW LEVEL SECURITY;

-- ── 3. pending confirmations ─────────────────────────────────────────────────
-- The bot NEVER writes a document straight from a parsed message. It stores the
-- draft here, shows it, and waits for an explicit button press. An Israeli tax
-- document is immutable once issued (see the immutability triggers) and can only
-- be undone with a credit note, so a misread "500" vs "5000" would be permanent.
-- The draft carries the FULL computed payload; the confirm step re-reads it from
-- here rather than re-parsing, so what the user saw is exactly what gets written.

CREATE TABLE IF NOT EXISTS whatsapp_pending_actions (
  id          uuid PRIMARY KEY,
  phone       text NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('document', 'expense')),
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS whatsapp_pending_phone_idx
  ON whatsapp_pending_actions (phone, created_at DESC);

ALTER TABLE whatsapp_pending_actions ENABLE ROW LEVEL SECURITY;

-- ── 4. inbound dedupe ────────────────────────────────────────────────────────
-- Meta redelivers a webhook until it gets a 200, and redelivery after a slow
-- (but successful) run is normal. Without this, one "confirm" tap could issue
-- the same invoice twice. INSERT ... ON CONFLICT DO NOTHING is the lock.

CREATE TABLE IF NOT EXISTS whatsapp_processed (
  message_id   text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_processed ENABLE ROW LEVEL SECURITY;

-- ── 5. monthly cap ───────────────────────────────────────────────────────────
-- Same reasoning as expense_scan_usage: the in-memory rate limiter resets on
-- every cold start and cannot bound a month's spend. Here each inbound message
-- costs both an Anthropic call AND (from 2026-10-01, when Meta starts billing
-- service messages) a per-message WhatsApp fee, so an unbounded loop is a direct
-- cash leak. 200 actions/month is far above observed need and bounds worst case
-- to roughly $2-3/user/month.

CREATE TABLE IF NOT EXISTS whatsapp_usage (
  user_id uuid NOT NULL,
  month   text NOT NULL, -- 'YYYY-MM', Israel-local
  count   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

ALTER TABLE whatsapp_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION increment_whatsapp_usage(p_user_id uuid, p_month text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO whatsapp_usage (user_id, month, count)
  VALUES (p_user_id, p_month, 1)
  ON CONFLICT (user_id, month) DO UPDATE
    SET count = whatsapp_usage.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION increment_whatsapp_usage(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_whatsapp_usage(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION increment_whatsapp_usage(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_whatsapp_usage(uuid, text) TO service_role;

-- ── 6. the bot's document writer ─────────────────────────────────────────────
--
-- WHY THIS EXISTS AT ALL
-- create_document_atomic is SECURITY DEFINER and hard-fails when auth.uid() is
-- NULL, which is always true for the bot (service-role, no browser session). The
-- tempting shortcut is a direct service-role INSERT from TypeScript, which is
-- what documents-server.ts does for the billing cron. That shortcut moves
-- numbering, the money invariant and the exempt-VAT rule OUT of the database and
-- into app code, where nothing enforces them. For a channel where users create
-- real tax documents that is not acceptable, so the guarantees stay in SQL here.
--
-- HOW IT DIFFERS FROM create_document_atomic
--   * ownership is proved by an explicit p_user_id instead of auth.uid()
--   * granted to service_role ONLY (revoked from PUBLIC/anon/authenticated)
--   * DELIBERATELY NARROW SURFACE. No explicit p_number, no original_document_id,
--     no foreign currency, no discount, no withholding, no credit notes. Every
--     parameter removed is one less thing that can drift out of sync with
--     create_document_atomic, and one less thing a misparsed sentence can reach.
--
-- MAINTENANCE: the money invariant and the exempt-VAT rule below are mirrored
-- from create_document_atomic. If either changes there, change it here too.

CREATE OR REPLACE FUNCTION public.create_document_for_bot(
  p_user_id     uuid,
  p_business_id uuid,
  p_id          uuid,
  p_type        text,
  p_date        date,
  p_client_id   uuid,
  p_client_name text,
  p_subject     text,
  p_status      text,
  p_subtotal    numeric,
  p_vat         numeric,
  p_total       numeric,
  p_payment_method text,
  p_notes       text,
  p_items       jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_number int;
  v_business_user uuid;
  v_business_type text;
  v_item_sum numeric;
  v_tol constant numeric := 0.01;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT user_id, business_type INTO v_business_user, v_business_type
  FROM businesses WHERE id = p_business_id;
  IF v_business_user IS NULL OR v_business_user IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Narrow type allowlist: RECEIPT and QUOTE only.
  --
  -- credit_note and proforma are absent because a credit note reverses a real
  -- document and must never be reachable from a parsed sentence.
  --
  -- tax_invoice and tax_invoice_receipt are absent for a stronger reason: they
  -- are the two types that can require a מספר הקצאה (allocation number) from
  -- רשות המסים. requiresAllocationNumber() in src/lib/tax-authority.ts triggers
  -- on exactly those types once the customer has a VAT number and the pre-VAT
  -- amount clears the threshold, and receipt-editor.tsx blocks DELIVERY of such
  -- a document until the number is obtained. A chat channel has no equivalent
  -- gate and no place to capture the customer's tax id, so a bot-issued tax
  -- invoice to a business over the threshold would be an immutable document
  -- that is missing something the law requires — and the recipient could not
  -- deduct the VAT.
  --
  -- Receipts and quotes never require an allocation number at any amount, so
  -- restricting the channel to those two removes the entire class rather than
  -- reimplementing the allocation flow inside a conversation. Widening this
  -- list means building that gate first.
  IF p_type NOT IN ('receipt', 'quote') THEN
    RAISE EXCEPTION 'document type % is not available over the bot channel', p_type;
  END IF;

  IF p_status NOT IN ('draft', 'sent', 'paid') THEN
    RAISE EXCEPTION 'invalid status %', p_status;
  END IF;

  IF COALESCE(p_total, 0) <= 0 THEN
    RAISE EXCEPTION 'total must be positive (got %)', p_total;
  END IF;

  -- Mirrored from create_document_atomic: total = subtotal + vat.
  -- (No rounding/discount params on this surface, so both drop out.)
  IF ABS(COALESCE(p_total, 0) - (COALESCE(p_subtotal, 0) + COALESCE(p_vat, 0))) > v_tol THEN
    RAISE EXCEPTION 'inconsistent totals: total (%) <> subtotal (%) + vat (%)',
      p_total, p_subtotal, p_vat;
  END IF;

  -- Sign rails. total > 0 alone is not enough: a negative subtotal paired with
  -- an oversized VAT satisfies both the positivity check and the sum invariant
  -- while describing a document that cannot exist. Only a credit note carries
  -- negative money, and credit notes are not on this surface at all.
  IF COALESCE(p_subtotal, 0) < 0 OR COALESCE(p_vat, 0) < 0 THEN
    RAISE EXCEPTION 'negative money not allowed on this channel (subtotal %, vat %)',
      p_subtotal, p_vat;
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items must be a non-empty array';
  END IF;

  -- Per-line reconciliation: quantity x unit_price must equal the line total.
  -- The sum check below only proves the lines ADD UP to the subtotal, which a
  -- set of internally nonsensical lines can also do. These values are printed
  -- verbatim on the PDF and exported to רשות המסים, where a line that does not
  -- multiply out is a rejected filing.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS item
    WHERE (item->>'quantity')::numeric <= 0
       OR (item->>'unit_price')::numeric < 0
       OR ABS((item->>'quantity')::numeric * (item->>'unit_price')::numeric
              - (item->>'total')::numeric) > v_tol
  ) THEN
    RAISE EXCEPTION 'a line item does not reconcile (quantity x unit_price <> total)';
  END IF;

  SELECT COALESCE(SUM((item->>'total')::numeric), 0) INTO v_item_sum
  FROM jsonb_array_elements(p_items) AS item;
  IF ABS(v_item_sum - COALESCE(p_subtotal, 0)) > v_tol THEN
    RAISE EXCEPTION 'item totals (%) do not sum to subtotal (%)', v_item_sum, p_subtotal;
  END IF;

  IF v_business_type = 'exempt' AND ABS(COALESCE(p_vat, 0)) > v_tol THEN
    RAISE EXCEPTION 'exempt business (עוסק פטור) cannot charge VAT (got %)', p_vat;
  END IF;

  -- An עוסק פטור is legally forbidden from issuing חשבונית מס / חשבונית מס
  -- קבלה at all, even at 0% VAT — it is not just a VAT-amount rule. The check
  -- above only catches a nonzero VAT; without this one, a zero-VAT tax
  -- invoice would slip through for an exempt business. Mirrors
  -- canIssueTaxInvoicesByType in src/lib/vat.ts (authorized/company only).
  IF v_business_type NOT IN ('authorized', 'company')
     AND p_type IN ('tax_invoice', 'tax_invoice_receipt') THEN
    RAISE EXCEPTION 'exempt business (עוסק פטור) cannot issue % (חשבונית מס)', p_type;
  END IF;

  -- p_client_id, if given, must belong to THIS business. Without this check a
  -- cross-tenant client id would still pass the INSERT (there is no FK back to
  -- p_business_id), and the resulting document would be rendered by the public
  -- document endpoint carrying that other business's client's tax ID, address,
  -- phone and email — exposed through a shared URL to whoever the bot's user
  -- forwards the link to.
  IF p_client_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM clients WHERE id = p_client_id AND business_id = p_business_id
    ) THEN
      RAISE EXCEPTION 'client % does not belong to business %', p_client_id, p_business_id;
    END IF;
  END IF;

  INSERT INTO document_counters (business_id, doc_type, next_number)
  VALUES (p_business_id, p_type, CASE WHEN p_type = 'receipt' THEN 1001 ELSE 201 END)
  ON CONFLICT (business_id, doc_type) DO NOTHING;

  UPDATE document_counters
  SET next_number = next_number + 1
  WHERE business_id = p_business_id AND doc_type = p_type
  RETURNING next_number - 1 INTO v_number;

  INSERT INTO documents (
    id, business_id, type, number, date, client_id, client_name,
    subject, status, subtotal, vat, total, payment_method, notes,
    currency, exchange_rate, subtotal_ils, vat_ils, total_ils, zero_rated,
    rounding, round_total
  ) VALUES (
    p_id, p_business_id, p_type, v_number, p_date, p_client_id, p_client_name,
    p_subject, p_status, p_subtotal, p_vat, p_total, p_payment_method, p_notes,
    'ILS', 1, p_subtotal, p_vat, p_total, false,
    0, false
  );

  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO document_items (id, document_id, product_id, description, quantity, unit_price, total, sort_order)
    SELECT (item->>'id')::uuid, p_id, NULL,
      item->>'description', (item->>'quantity')::numeric, (item->>'unit_price')::numeric,
      (item->>'total')::numeric, (idx - 1)::int
    FROM jsonb_array_elements(p_items) WITH ORDINALITY arr(item, idx);
  END IF;

  RETURN json_build_object('id', p_id, 'number', v_number);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_document_for_bot(
  uuid, uuid, uuid, text, date, uuid, text, text, text,
  numeric, numeric, numeric, text, text, jsonb
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.create_document_for_bot(
  uuid, uuid, uuid, text, date, uuid, text, text, text,
  numeric, numeric, numeric, text, text, jsonb
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_document_for_bot(
  uuid, uuid, uuid, text, date, uuid, text, text, text,
  numeric, numeric, numeric, text, text, jsonb
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.create_document_for_bot(
  uuid, uuid, uuid, text, date, uuid, text, text, text,
  numeric, numeric, numeric, text, text, jsonb
) TO service_role;

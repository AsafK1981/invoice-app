-- ============================================================================
-- document_items immutability (2026-08-16)
--
-- Gap: enforce_document_immutability() (20260807-…) locks the money and
-- identity columns of an issued `documents` row at the DB level, but the
-- line items that make up that document had NO guard at all - only a plain
-- RLS UPDATE/DELETE policy scoped to the owning user. Anyone with the
-- owner's session (or a bug in our own code) could rewrite the lines of an
-- invoice the customer already received, and the DB would not object. The
-- defense-in-depth reasoning that added the documents trigger ("a direct DB
-- write would bypass the app-level check") applies verbatim to the items.
--
-- Rule (mirrors the documents trigger's model):
--   * UPDATE of an item whose parent document is NOT a draft is rejected
--     when any content column changes: description, quantity, unit_price,
--     total, sort_order, document_id.
--     product_id may still change - products.id has ON DELETE SET NULL on
--     document_items.product_id, so deleting a product from the catalogue
--     legitimately nulls it on historical lines. That is a catalogue event,
--     not a change to the invoice.
--   * DELETE of an item whose parent document is NOT a draft is rejected,
--     UNLESS the parent row is gone/going - i.e. the delete is the
--     ON DELETE CASCADE from deleting the parent document. Inside the
--     cascade the parent row is already deleted in this transaction, so
--     the lookup below finds nothing and we let the row go. Whether the
--     parent itself may be deleted is the parent trigger's decision
--     (never once emailed_at is set), so items inherit exactly that rule.
--   * INSERT is untouched (documents are created as issued in one RPC).
--
-- App code adjusted in the same commit:
--   src/lib/document-store.ts   deleteDocument: no longer deletes items first;
--                               deletes the parent and lets CASCADE do it.
--   src/app/api/delete-account  same, and clears emailed_at first (it was
--                               silently failing on any account that ever
--                               emailed an invoice - see route comment).
--
-- Idempotent. Apply with: node scripts/run-sql-file.mjs scripts/migrations/20260816-document-items-immutability.sql
-- ============================================================================

-- SECURITY DEFINER so the parent lookup below is NOT subject to the caller's
-- RLS view of `documents`: the guard must see the true parent row regardless
-- of who is writing (authenticated user, service role, bot RPC). Without it a
-- caller whose RLS view hides the parent would hit NOT FOUND and be waved
-- through as if this were a cascade. Trigger functions cannot be invoked via
-- SQL or PostgREST ("trigger functions can only be called as triggers"), so
-- no EXECUTE grant surface is opened; search_path is pinned anyway.
CREATE OR REPLACE FUNCTION public.enforce_document_item_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  parent_status text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    SELECT status INTO parent_status FROM public.documents WHERE id = OLD.document_id;
    IF NOT FOUND THEN
      -- Parent already deleted in this transaction (ON DELETE CASCADE) or
      -- orphan row: nothing left to protect.
      RETURN OLD;
    END IF;
    IF parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'line items of an issued document cannot be deleted; cancel via credit note';
    END IF;
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE'
  SELECT status INTO parent_status FROM public.documents WHERE id = OLD.document_id;
  IF FOUND AND parent_status IS DISTINCT FROM 'draft' THEN
    IF NEW.document_id IS DISTINCT FROM OLD.document_id THEN RAISE EXCEPTION 'line items of an issued document are immutable: field % cannot be changed', 'document_id'; END IF;
    IF NEW.description IS DISTINCT FROM OLD.description THEN RAISE EXCEPTION 'line items of an issued document are immutable: field % cannot be changed', 'description'; END IF;
    IF NEW.quantity    IS DISTINCT FROM OLD.quantity    THEN RAISE EXCEPTION 'line items of an issued document are immutable: field % cannot be changed', 'quantity'; END IF;
    IF NEW.unit_price  IS DISTINCT FROM OLD.unit_price  THEN RAISE EXCEPTION 'line items of an issued document are immutable: field % cannot be changed', 'unit_price'; END IF;
    IF NEW.total       IS DISTINCT FROM OLD.total       THEN RAISE EXCEPTION 'line items of an issued document are immutable: field % cannot be changed', 'total'; END IF;
    IF NEW.sort_order  IS DISTINCT FROM OLD.sort_order  THEN RAISE EXCEPTION 'line items of an issued document are immutable: field % cannot be changed', 'sort_order'; END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_document_item_immutability ON public.document_items;
CREATE TRIGGER trg_enforce_document_item_immutability
  BEFORE UPDATE OR DELETE ON public.document_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_item_immutability();

COMMENT ON FUNCTION public.enforce_document_item_immutability() IS
  'DB-level guard: line items of a non-draft document cannot be edited or deleted (except product_id nulling and the CASCADE from deleting the parent). See scripts/migrations/20260816-document-items-immutability.sql';

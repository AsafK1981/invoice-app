-- Add a proper foreign-key reference from a credit note (חשבונית זיכוי) back to
-- the original tax invoice it reverses.
--
-- Until now a credit note only carried its reference as a Hebrew line prepended
-- to `notes` ("בגין חשבונית מס מספר X מתאריך Y"). That renders on the PDF but is
-- not queryable and can't be verified for integrity. This adds a real FK column.
--
-- Additive and backward-compatible:
--   * nullable — every existing row stays valid, and credit notes referencing an
--     externally-issued invoice (manual entry, no app record) keep it NULL.
--   * ON DELETE SET NULL — if the original doc is ever removed, the credit note
--     survives with a null reference rather than blocking the delete.
--
-- NOT added to the immutability trigger's blocked set: the column is set once at
-- creation (or via a one-time follow-up update) and never mutated afterward.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS original_document_id uuid
  REFERENCES public.documents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.documents.original_document_id IS
  'For a credit note: the original tax invoice it reverses (NULL for externally-issued originals entered manually).';

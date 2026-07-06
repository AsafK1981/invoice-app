-- Optional "round total to whole shekel" (הפרש עיגול) feature — additive columns.
--
-- Israeli practice: a document's final total may be rounded to a whole unit of
-- its currency (no agorot) while VAT stays EXACT. The subtotal and VAT are left
-- untouched; a signed rounding adjustment (between -0.5 and +0.5) absorbs the
-- difference so the invariant becomes total = subtotal + vat + rounding.
--
--   documents.rounding      numeric  — the signed הפרש עיגול (0 when off)
--   documents.round_total   boolean  — whether rounding was applied on this doc
--   businesses.round_total_default boolean — per-business default for the toggle
--
-- All three are additive with safe defaults, so existing rows are unaffected
-- (rounding=0, round_total=false ⇒ identical to prior behavior).

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS rounding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_total boolean NOT NULL DEFAULT false;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS round_total_default boolean NOT NULL DEFAULT false;

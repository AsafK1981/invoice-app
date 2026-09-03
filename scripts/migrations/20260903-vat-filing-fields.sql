-- ============================================================================
-- VAT filing fields (2026-09-03)
--
-- The periodic VAT return and its PCN874 detailed file need three things the
-- expenses table never stored: who the supplier is for מע"מ (their VAT
-- number), which supplier invoice the input VAT came from (reference), and
-- whether the purchase is equipment (מס תשומות ציוד is its own box on the
-- return). A fourth column holds the supplier invoice's מספר הקצאה, which
-- since 2024 the ITA requires before recognising input VAT above the
-- חשבונית ישראל threshold.
--
-- income_tax_advance_rate on businesses is the percentage from the פנקס
-- מקדמות; the מקדמות report multiplies the period's turnover by it.
--
-- All nullable / defaulted, so existing rows and the untouched write paths
-- (assistant, WhatsApp, imports) keep working. APPLY BEFORE DEPLOYING the
-- code that writes these columns: expenseStore.save() and saveBusiness()
-- write them on every save.
--
-- Idempotent. Apply with:
--   node scripts/run-sql-file.mjs --reason "vat filing fields" scripts/migrations/20260903-vat-filing-fields.sql
-- ============================================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS supplier_tax_id text,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS is_equipment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allocation_number text;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS income_tax_advance_rate numeric(5,2);

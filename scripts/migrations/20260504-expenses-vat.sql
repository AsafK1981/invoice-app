-- Add vat_amount to expenses for input-VAT credit on periodic VAT returns.
--
-- עוסק מורשה files מע"מ periodically and can deduct VAT paid on business
-- expenses (מע"מ תשומות) from the VAT collected on sales (מע"מ עסקאות).
-- Without this column we couldn't compute net VAT due.
--
-- Default 0 so existing rows are unaffected and עוסק פטור (who never
-- charges/deducts VAT) sees no behavior change.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC DEFAULT 0;

COMMENT ON COLUMN expenses.vat_amount IS
  'VAT (מע"מ) component of the expense. Used by עוסק מורשה for input VAT credit on periodic VAT returns.';

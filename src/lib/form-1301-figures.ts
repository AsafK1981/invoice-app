// The expense figure the form 1301 helper shows and subtracts. One number for
// both, so the expenses row and the profit row can never disagree.

import { canIssueTaxInvoicesByType } from "./vat";

export function form1301Expenses(
  expenses: { amount: number; vatAmount?: number }[],
  businessType: string | null | undefined,
): { totalExpenses: number; vatInput: number; deductibleExpenses: number } {
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const vatInput = expenses.reduce((s, e) => s + (e.vatAmount || 0), 0);
  // A VAT-registered dealer reclaims input VAT, so its expense is the net
  // amount. An עוסק פטור reclaims nothing: the VAT is part of the cost and the
  // expense is the gross amount, even if a stored row carries a VAT figure.
  const deductibleExpenses = canIssueTaxInvoicesByType(businessType) ? totalExpenses - vatInput : totalExpenses;
  return { totalExpenses, vatInput, deductibleExpenses };
}

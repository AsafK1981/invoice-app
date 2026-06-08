import type { Business } from "./types";

/**
 * Israeli VAT rates by business type.
 * Updated 2025: standard rate is 18%.
 * עוסק פטור pays no VAT.
 */
export const VAT_RATES = {
  exempt: 0,
  authorized: 18,
  company: 18,
} as const;

export function getVatRate(business: Business | null | undefined): number {
  if (!business) return 0;
  return VAT_RATES[business.businessType] ?? 0;
}

/**
 * Derive a document's whole-number VAT rate from its stored vat/subtotal.
 * Israeli VAT is always an integer percent (18% since 2025); rounding
 * avoids sending 17.99/18.01 to the Tax Authority (a line/header mismatch
 * it would reject). Falls back to the canonical standard rate when
 * subtotal is 0.
 */
export function deriveVatRate(vat: number, subtotal: number): number {
  if (subtotal > 0) return Math.round((vat / subtotal) * 100);
  return VAT_RATES.authorized;
}

/**
 * Calculate VAT given a subtotal and rate (as percent, e.g. 18 for 18%).
 */
export function calculateVat(subtotal: number, ratePercent: number): number {
  return round2(subtotal * (ratePercent / 100));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type VatMode = "exclusive" | "inclusive";

interface AmountInput {
  quantity: number;
  unitPrice: number;
}

export function computeAmounts(items: AmountInput[], vatRate: number, vatMode: VatMode) {
  // Header figures are summed from the SAME per-line rounded amounts the
  // document persists (receipt-editor stores round2(qty × round2(unit ×
  // factor)) per line). Rounding the per-line nets and summing those —
  // rather than rounding one big gross sum — guarantees the line items
  // always reconcile with the header subtotal/VAT/total (otherwise they
  // could drift a few agorot apart, which both looks wrong on the document
  // and gets a tax-export rejected for a line/header mismatch).
  const sum = (arr: number[]) => round2(arr.reduce((s, n) => s + n, 0));

  if (vatRate === 0) {
    const lineTotals = items.map((i) => round2(i.quantity * round2(i.unitPrice)));
    const subtotal = sum(lineTotals);
    return { subtotal, vat: 0, total: subtotal, netUnitPriceFactor: 1 };
  }
  if (vatMode === "inclusive") {
    const factor = 1 / (1 + vatRate / 100);
    const lineNets = items.map((i) => round2(i.quantity * round2(i.unitPrice * factor)));
    const lineGross = items.map((i) => round2(i.quantity * i.unitPrice));
    const subtotal = sum(lineNets);
    const total = sum(lineGross);
    return { subtotal, vat: round2(total - subtotal), total, netUnitPriceFactor: factor };
  }
  const lineNets = items.map((i) => round2(i.quantity * round2(i.unitPrice)));
  const subtotal = sum(lineNets);
  const vat = calculateVat(subtotal, vatRate);
  return { subtotal, vat, total: round2(subtotal + vat), netUnitPriceFactor: 1 };
}

/**
 * String-level predicate for "this business charges VAT and can issue
 * tax invoices (חשבונית מס)" — i.e. עוסק מורשה or חברה. Works directly on
 * a raw DB `business_type` value, so server routes holding a Supabase row
 * (not a `Business`) can share the same rule as the UI.
 */
export function canIssueTaxInvoicesByType(type: string | null | undefined): boolean {
  return type === "authorized" || type === "company";
}

/**
 * Returns true if the business can issue tax invoices (חשבונית מס).
 */
export function canIssueTaxInvoices(business: Business | null | undefined): boolean {
  return canIssueTaxInvoicesByType(business?.businessType);
}

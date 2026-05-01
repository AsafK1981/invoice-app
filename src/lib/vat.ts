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
  const sumLines = (factor = 1) =>
    items.reduce((s, i) => s + i.quantity * i.unitPrice * factor, 0);

  if (vatRate === 0) {
    const subtotal = round2(sumLines());
    return { subtotal, vat: 0, total: subtotal, netUnitPriceFactor: 1 };
  }
  if (vatMode === "inclusive") {
    const factor = 1 / (1 + vatRate / 100);
    const totalGross = sumLines();
    const subtotal = totalGross * factor;
    return {
      subtotal: round2(subtotal),
      vat: round2(totalGross - subtotal),
      total: round2(totalGross),
      netUnitPriceFactor: factor,
    };
  }
  const subtotal = sumLines();
  return {
    subtotal: round2(subtotal),
    vat: calculateVat(subtotal, vatRate),
    total: round2(subtotal * (1 + vatRate / 100)),
    netUnitPriceFactor: 1,
  };
}

/**
 * Returns true if the business can issue tax invoices (חשבונית מס).
 */
export function canIssueTaxInvoices(business: Business | null | undefined): boolean {
  if (!business) return false;
  return business.businessType === "authorized" || business.businessType === "company";
}

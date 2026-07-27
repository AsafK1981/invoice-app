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
  // Round to 2 decimals (agorot), robust to float half-agora boundaries. A
  // value like 1.005 is stored a hair below (100.4999…), so a plain
  // Math.round(n * 100) drops it to 1.00. Nudge by a magnitude-scaled epsilon
  // so x.xx5 rounds up even for large sums, symmetrically for negatives
  // (credit notes) → |round2(-x)| === round2(x). Values already at 2 decimals
  // round to themselves, so per-line reconciliation is unaffected.
  const scaled = n * 100;
  return Math.round(scaled + Math.sign(scaled) * Number.EPSILON * Math.abs(scaled)) / 100;
}

export type VatMode = "exclusive" | "inclusive";

interface AmountInput {
  quantity: number;
  unitPrice: number;
}

/**
 * Optionally round a computed total to a whole unit of the document currency
 * using the Israeli הפרש עיגול method: the subtotal and VAT stay EXACTLY as
 * computed; a signed rounding adjustment (between -0.5 and +0.5) absorbs the
 * difference so VAT is never distorted. Invariant: total = subtotal + vat +
 * rounding. When `roundTotal` is false, rounding is 0 and the total is left
 * unchanged (identical to the pre-feature behavior).
 *
 * `base.subtotal`/`base.vat` are assumed already round2'd; round2 on the raw
 * sum guards against half-shekel float drift (e.g. 100.10 + 18.40) so the
 * whole-unit rounding lands on the correct side.
 */
function withRounding<T extends { subtotal: number; vat: number; total: number }>(
  base: T,
  roundTotal: boolean,
): T & { rounding: number } {
  if (!roundTotal) return { ...base, rounding: 0 };
  const target = base.subtotal + base.vat;
  const roundedTotal = Math.round(round2(target));
  const rounding = round2(roundedTotal - target);
  return { ...base, rounding, total: roundedTotal };
}

/**
 * Apply an optional document-level discount (הנחה) to a computed base, BEFORE
 * VAT. The base `subtotal` is the lines subtotal (pre-discount); the discounted
 * subtotal drives VAT and total. When `discount` is 0 (default) the base is
 * returned unchanged, so every existing caller keeps identical results; the
 * VAT-inclusive gross-sum reconciliation in particular is only bypassed when a
 * discount is actually present (a rare case). Returns the effective `discount`
 * that was applied (clamped to [0, subtotal)) alongside the adjusted figures.
 */
function withDiscount(
  base: { subtotal: number; vat: number; total: number; netUnitPriceFactor: number },
  vatRate: number,
  discount: number,
): { subtotal: number; vat: number; total: number; netUnitPriceFactor: number; discount: number } {
  const d = round2(discount);
  if (!(d > 0) || d >= base.subtotal) {
    return { ...base, discount: 0 };
  }
  const subtotal = round2(base.subtotal - d);
  const vat = vatRate === 0 ? 0 : calculateVat(subtotal, vatRate);
  return {
    subtotal,
    vat,
    total: round2(subtotal + vat),
    netUnitPriceFactor: base.netUnitPriceFactor,
    discount: d,
  };
}

export function computeAmounts(
  items: AmountInput[],
  vatRate: number,
  vatMode: VatMode,
  roundTotal = false,
  discount = 0,
) {
  // Header figures are summed from the SAME per-line rounded amounts the
  // document persists (receipt-editor stores round2(qty × round2(unit ×
  // factor)) per line). Rounding the per-line nets and summing those,
  // rather than rounding one big gross sum, guarantees the line items
  // always reconcile with the header subtotal/VAT/total (otherwise they
  // could drift a few agorot apart, which both looks wrong on the document
  // and gets a tax-export rejected for a line/header mismatch).
  const sum = (arr: number[]) => round2(arr.reduce((s, n) => s + n, 0));

  if (vatRate === 0) {
    const lineTotals = items.map((i) => round2(i.quantity * round2(i.unitPrice)));
    const subtotal = sum(lineTotals);
    const adj = withDiscount({ subtotal, vat: 0, total: subtotal, netUnitPriceFactor: 1 }, vatRate, discount);
    return { ...withRounding(adj, roundTotal), discount: adj.discount };
  }
  if (vatMode === "inclusive") {
    const factor = 1 / (1 + vatRate / 100);
    const lineNets = items.map((i) => round2(i.quantity * round2(i.unitPrice * factor)));
    const lineGross = items.map((i) => round2(i.quantity * i.unitPrice));
    const subtotal = sum(lineNets);
    const total = sum(lineGross);
    const adj = withDiscount(
      { subtotal, vat: round2(total - subtotal), total, netUnitPriceFactor: factor },
      vatRate,
      discount,
    );
    return { ...withRounding(adj, roundTotal), discount: adj.discount };
  }
  const lineNets = items.map((i) => round2(i.quantity * round2(i.unitPrice)));
  const subtotal = sum(lineNets);
  const vat = calculateVat(subtotal, vatRate);
  const adj = withDiscount(
    { subtotal, vat, total: round2(subtotal + vat), netUnitPriceFactor: 1 },
    vatRate,
    discount,
  );
  return { ...withRounding(adj, roundTotal), discount: adj.discount };
}

/**
 * String-level predicate for "this business charges VAT and can issue
 * tax invoices (חשבונית מס)", i.e. עוסק מורשה or חברה. Works directly on
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

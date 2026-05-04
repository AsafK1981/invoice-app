/**
 * Israel Tax Authority (רשות המיסים) "חשבונית ישראל" API integration.
 *
 * This API is required for tax invoices (חשבונית מס) above a threshold
 * (currently ~25,000 NIS in 2026, will lower over time).
 *
 * Status: STUB. Activate when:
 *   1. Business owner becomes עוסק מורשה
 *   2. Has obtained a digital signing certificate (Comsign / PersonalID)
 *   3. Has registered with רשות המיסים for API access
 *   4. Has set TAX_AUTHORITY_API_KEY and TAX_AUTHORITY_CERT_PATH env vars
 *
 * Reference: https://www.gov.il/he/departments/general/checkout-isr-system
 */

import type { InvoiceDocument } from "./types";

export interface AllocationNumberResponse {
  allocationNumber: string;
  signedAt: string;
}

export interface TaxAuthorityConfig {
  apiKey: string;
  certPath: string;
  apiUrl?: string;
}

/**
 * Threshold above which an allocation number is required, by calendar year.
 * רשות המסים lowers this on a published rollout schedule. Update each
 * January when new figures are released.
 *
 * Source: https://www.gov.il/he/departments/general/checkout-isr-system
 *   2024: 25,000 ₪
 *   2025: 20,000 ₪
 *   2026: 5,000 ₪  (per published rollout — verify current figure)
 */
const THRESHOLD_BY_YEAR: Record<number, number> = {
  2024: 25_000,
  2025: 20_000,
  2026: 5_000,
};
const FALLBACK_THRESHOLD_NIS = 5_000;

export function getAllocationThresholdForYear(year: number): number {
  return THRESHOLD_BY_YEAR[year] ?? FALLBACK_THRESHOLD_NIS;
}

/** Back-compat constant for callers that don't carry a year. Uses current year. */
export const ALLOCATION_THRESHOLD_NIS = getAllocationThresholdForYear(new Date().getFullYear());

export function requiresAllocationNumber(doc: InvoiceDocument): boolean {
  // Only חשבונית מס and חשבונית מס/קבלה require allocation numbers; other
  // doc types (receipts, quotes, credit notes — wait, credit notes DO under
  // some circumstances, but only those issued by עוסק מורשה for paired
  // tax invoices, so we conservatively include them too).
  const isTaxDoc =
    doc.type === "tax_invoice" ||
    doc.type === "tax_invoice_receipt" ||
    doc.type === "credit_note";
  if (!isTaxDoc) return false;

  const docYear = parseInt(doc.date.slice(0, 4), 10) || new Date().getFullYear();
  const threshold = getAllocationThresholdForYear(docYear);
  return Math.abs(doc.total) >= threshold;
}

/**
 * Request an allocation number from the tax authority.
 *
 * STUB: Returns null if not configured.
 * When configured, will POST to https://invoices.gov.il/api/...
 * with signed payload and return the allocation number.
 */
export async function getAllocationNumber(
  doc: InvoiceDocument,
  config?: TaxAuthorityConfig
): Promise<AllocationNumberResponse | null> {
  if (!config?.apiKey || !config?.certPath) {
    console.warn(
      "[Tax Authority] Not configured. Skipping allocation number for document",
      doc.number
    );
    return null;
  }

  // TODO when activated:
  // 1. Sign payload with the certificate
  // 2. POST to invoice-allocation endpoint
  // 3. Parse response and return allocation number
  // 4. Handle errors (rate limits, auth failures, etc.)

  throw new Error(
    "Tax Authority API integration not yet activated. " +
      "Build the actual signing + HTTP request when certificate is obtained."
  );
}

/**
 * Check if the current environment has the necessary configuration.
 */
export function isTaxAuthorityConfigured(): boolean {
  return !!(process.env.TAX_AUTHORITY_API_KEY && process.env.TAX_AUTHORITY_CERT_PATH);
}

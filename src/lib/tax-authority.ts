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
 * Threshold above which an allocation number is required.
 * Currently 25,000 NIS, will lower in future years per Tax Authority schedule.
 */
export const ALLOCATION_THRESHOLD_NIS = 25000;

export function requiresAllocationNumber(doc: InvoiceDocument): boolean {
  if (doc.type !== "tax_invoice") return false;
  return Math.abs(doc.total) >= ALLOCATION_THRESHOLD_NIS;
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

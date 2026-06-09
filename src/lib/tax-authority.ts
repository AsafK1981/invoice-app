/**
 * Israel Tax Authority "Israel Invoice" (חשבונית ישראל) API client.
 *
 * The Tax Authority requires invoices above a threshold (₪10,000 in
 * 2026, ₪5,000 starting June 2026) to carry a 9-digit "allocation
 * number" obtained from this API before the invoice is finalized.
 *
 * Without the allocation number the recipient cannot deduct VAT — so
 * for עוסק מורשה customers this integration is critical.
 *
 * Auth model: OAuth2 authorization code with long-lived refresh
 * tokens. Each business goes through the gov.il consent screen once;
 * we store their refresh token and use it server-side to mint fresh
 * access tokens for every allocation request.
 *
 * Source of truth:
 *   - gov.il PDF "מודל חשבוניות ישראל תיאור ה-API's" (v2.0, 7/2024)
 *   - github.com/dsaddan/Israel-Tax-Authority-OpenAPI-Taxes-Demo
 *
 * Pre-prod prerequisites (these are MANUAL, not code):
 *   1. Register as a software vendor at gov.il → get client_id +
 *      client_secret + Accounting_Software_Number
 *   2. Set env vars TAX_AUTHORITY_CLIENT_ID, _CLIENT_SECRET,
 *      _SOFTWARE_NUMBER, optionally _ENV=production
 *   3. Each user (עוסק מורשה) goes through OAuth at gov.il to
 *      authorize us to act on their VAT-number-scoped behalf
 */

import type { InvoiceDocument } from "./types";

const ENV = (process.env.TAX_AUTHORITY_ENV || "sandbox") as "sandbox" | "production";
const CLIENT_ID = process.env.TAX_AUTHORITY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.TAX_AUTHORITY_CLIENT_SECRET || "";
const SOFTWARE_NUMBER = parseInt(process.env.TAX_AUTHORITY_SOFTWARE_NUMBER || "0", 10);
const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || "https://mysuperfriendlyinvoiceapp.vercel.app";

const SHAAM_BASE =
  ENV === "production"
    ? "https://openapi.taxes.gov.il/shaam/production"
    : "https://openapi.taxes.gov.il/shaam/tsandbox";
const ITA_BASE =
  ENV === "production"
    ? "https://ita-api.taxes.gov.il/shaam/production"
    : "https://ita-api.taxes.gov.il/shaam/tsandbox";

const CALLBACK_URL = `${APP_ORIGIN}/api/tax-authority/callback`;

export function isTaxAuthorityConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && SOFTWARE_NUMBER);
}

export function taxAuthorityEnv(): "sandbox" | "production" {
  return ENV;
}

/* ------------------------------------------------------------------ */
/* Threshold helpers — kept stable for legacy callers                  */
/* ------------------------------------------------------------------ */

const THRESHOLD_BY_YEAR: Record<number, number> = {
  2024: 25_000,
  2025: 20_000,
  2026: 10_000, // drops to 5,000 in June 2026 — see allocationRequiredThreshold
};
const FALLBACK_THRESHOLD_NIS = 5_000;

export function getAllocationThresholdForYear(year: number): number {
  return THRESHOLD_BY_YEAR[year] ?? FALLBACK_THRESHOLD_NIS;
}

/**
 * Threshold honoring the mid-year drop on 2026-06-01 → ₪5,000.
 * Uses UTC so the invoice's calendar date determines the threshold
 * deterministically, regardless of the runtime timezone — a date string
 * like "2026-06-01" parses to UTC midnight, and reading the local month
 * on a UTC-negative host would otherwise mis-bucket it as May.
 */
export function allocationRequiredThreshold(date: Date = new Date()): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  if (y >= 2027) return 5_000;
  if (y === 2026 && m >= 6) return 5_000;
  if (y === 2026) return 10_000;
  if (y === 2025) return 20_000;
  return 25_000;
}

export const ALLOCATION_THRESHOLD_NIS = getAllocationThresholdForYear(new Date().getFullYear());

export function requiresAllocationNumber(doc: InvoiceDocument): boolean {
  const isTaxDoc =
    doc.type === "tax_invoice" ||
    doc.type === "tax_invoice_receipt" ||
    doc.type === "credit_note";
  if (!isTaxDoc) return false;
  const docDate = doc.date ? new Date(doc.date) : new Date();
  // The Tax Authority threshold is in ₪ — use the ₪ equivalent of a
  // foreign-currency document (falls back to total for legacy ILS docs).
  const amountIls = Math.abs((doc.totalIls ?? doc.total) as number);
  return amountIls >= allocationRequiredThreshold(docDate);
}

/* ------------------------------------------------------------------ */
/* OAuth flow                                                          */
/* ------------------------------------------------------------------ */

/** Build the URL we redirect the user to for gov.il consent. */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    scope: "scope",
    state,
    redirect_uri: CALLBACK_URL,
  });
  return `${SHAAM_BASE}/longtimetoken/oauth2/authorize?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "Bearer";
  vat_number?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: CALLBACK_URL,
  });
  const r = await fetch(`${SHAAM_BASE}/longtimetoken/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!r.ok) {
    throw new Error(`Tax Authority token exchange failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const r = await fetch(`${SHAAM_BASE}/longtimetoken/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!r.ok) {
    throw new Error(`Tax Authority token refresh failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as TokenResponse;
}

/* ------------------------------------------------------------------ */
/* Allocation request                                                  */
/* ------------------------------------------------------------------ */

export interface AllocationRequest {
  invoiceId: string;
  /** 305 = tax invoice; 320 = tax invoice receipt; 330 = credit note */
  invoiceType: 305 | 320 | 330;
  vatNumber: string;
  invoiceDate: string;
  issuanceDate: string;
  amountBeforeDiscount: number;
  discount: number;
  paymentAmount: number;
  vatAmount: number;
  paymentAmountIncludingVat: number;
  items: Array<{
    index: number;
    catalogId?: string;
    description: string;
    measureUnitDescription?: string;
    quantity: number;
    pricePerUnit: number;
    discount?: number;
    totalAmount: number;
    vatRate: number;
    vatAmount: number;
  }>;
}

export interface AllocationResponse {
  /** The 9-digit allocation number, or null on failure */
  allocationNumber: string | null;
  resultCode?: string;
  resultMessage?: string;
  raw: unknown;
}

export async function requestAllocation(
  accessToken: string,
  req: AllocationRequest,
): Promise<AllocationResponse> {
  const body = {
    Invoice_ID: req.invoiceId,
    Invoice_Type: req.invoiceType,
    Vat_Number: parseInt(req.vatNumber, 10),
    Invoice_Date: req.invoiceDate,
    Invoice_Issuance_Date: req.issuanceDate,
    Accounting_Software_Number: SOFTWARE_NUMBER,
    Amount_Before_Discount: req.amountBeforeDiscount,
    Discount: req.discount,
    Payment_Amount: req.paymentAmount,
    VAT_Amount: req.vatAmount,
    Payment_Amount_Including_VAT: req.paymentAmountIncludingVat,
    Items: req.items.map((it) => ({
      Index: it.index,
      Catalog_ID: it.catalogId || "",
      Description: it.description,
      Measure_Unit_Description: it.measureUnitDescription || "",
      Quantity: it.quantity,
      Price_Per_Unit: it.pricePerUnit,
      Discount: it.discount || 0,
      Total_Amount: it.totalAmount,
      VAT_Rate: it.vatRate,
      VAT_Amount: it.vatAmount,
    })),
  };

  const r = await fetch(`${ITA_BASE}/Invoices/v1/Approval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await r.json().catch(() => ({}));
  const asObj = (v: unknown): Record<string, unknown> | null =>
    typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  const obj = asObj(raw);

  if (!r.ok) {
    return {
      allocationNumber: null,
      resultCode: String(r.status),
      resultMessage: obj?.Result_Message ? String(obj.Result_Message) : "API error",
      raw,
    };
  }

  const allocNum = obj?.Allocation_Num ? String(obj.Allocation_Num) : null;
  const resultCode = obj?.Result_Code ? String(obj.Result_Code) : null;
  return {
    allocationNumber: allocNum && resultCode === "0" ? allocNum : null,
    resultCode: resultCode || undefined,
    resultMessage: obj?.Result_Message ? String(obj.Result_Message) : undefined,
    raw,
  };
}

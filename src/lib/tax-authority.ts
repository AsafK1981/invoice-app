/**
 * Israel Tax Authority "Israel Invoice" (חשבונית ישראל) API client.
 *
 * The Tax Authority requires invoices above a threshold (measured on
 * the PRE-VAT amount) to carry a 9-digit "allocation number" obtained
 * from this API before the invoice is finalized. The threshold steps
 * down over time: ₪20,000 in 2025, ₪10,000 from 2026-01-01, then
 * ₪5,000 from 2026-06-01 onward.
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

/**
 * Israeli-egress proxy. gov.il geo-blocks non-Israeli source IPs and Vercel
 * has no Israel region, so server-to-server calls (token exchange/refresh +
 * allocation) time out from Vercel. When TAX_AUTHORITY_PROXY_BASE is set we
 * route those calls through a reverse proxy on Cloud Run me-west1 (Tel Aviv),
 * whose Israeli egress IP gov.il accepts. Browser-facing URLs (the authorize
 * redirect) must NOT be proxied — the user's own Israeli IP reaches gov fine.
 */
const PROXY_BASE = (process.env.TAX_AUTHORITY_PROXY_BASE || "").replace(/\/$/, "");
const PROXY_KEY = process.env.TAX_AUTHORITY_PROXY_KEY || "";

const GOV_HOSTS: Record<string, string> = {
  "https://openapi.taxes.gov.il/": "openapi",
  "https://ita-api.taxes.gov.il/": "ita",
};

/**
 * Rewrite a direct gov.il URL to go through the Israeli proxy and attach the
 * shared-secret header. No-op (returns the direct URL) when the proxy is not
 * configured, so local dev from an Israeli IP still works unchanged.
 */
function viaProxy(
  url: string,
  headers: Record<string, string>,
): { url: string; headers: Record<string, string> } {
  if (!PROXY_BASE) return { url, headers };
  for (const [prefix, slug] of Object.entries(GOV_HOSTS)) {
    if (url.startsWith(prefix)) {
      return {
        url: `${PROXY_BASE}/${slug}/${url.slice(prefix.length)}`,
        headers: { ...headers, "x-proxy-key": PROXY_KEY },
      };
    }
  }
  return { url, headers };
}

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
  // ₪10,000 until 2026-05-31, then ₪5,000 from 2026-06-01. This yearly
  // table is a coarse legacy view; the date-aware allocationRequiredThreshold
  // is the single source of truth for the mid-year step.
  2026: 10_000,
};
const FALLBACK_THRESHOLD_NIS = 5_000;

export function getAllocationThresholdForYear(year: number): number {
  return THRESHOLD_BY_YEAR[year] ?? FALLBACK_THRESHOLD_NIS;
}

/**
 * Date-aware allocation threshold — the single source of truth for gating.
 * The legislated schedule steps down mid-2026:
 *   - 2025:                        ₪20,000
 *   - 2026-01-01 .. 2026-05-31:    ₪10,000
 *   - 2026-06-01 onward:           ₪5,000
 *   - 2027 and later:              ₪5,000
 * Uses UTC so the invoice's calendar date determines the threshold
 * deterministically, regardless of the runtime timezone — a date string
 * like "2026-01-01" parses to UTC midnight, and reading the local month
 * on a UTC-negative host would otherwise mis-bucket it into the prior year.
 */
export function allocationRequiredThreshold(date: Date = new Date()): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1-based month
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
  // The law measures the threshold against the PRE-VAT amount (סכום לפני
  // מע"מ), not the VAT-inclusive total. Use the ₪ equivalent of a
  // foreign-currency document (falls back to the raw subtotal for legacy
  // ILS docs).
  const amountIls = Math.abs((doc.subtotalIls ?? doc.subtotal) as number);
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
  const { url, headers } = viaProxy(`${SHAAM_BASE}/longtimetoken/oauth2/token`, {
    Authorization: `Basic ${basic}`,
    "Content-Type": "application/x-www-form-urlencoded",
  });
  const r = await fetch(url, { method: "POST", headers, body });
  if (!r.ok) {
    // Full upstream body stays in server logs only — never surfaced to the
    // client or persisted (gov.il bodies can carry internal detail).
    console.error("[tax-authority] token exchange failed", r.status, await r.text().catch(() => ""));
    throw new Error("שגיאה בהתחברות לרשות המסים. נסה שוב או חבר מחדש בהגדרות.");
  }
  return (await r.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const { url, headers } = viaProxy(`${SHAAM_BASE}/longtimetoken/oauth2/token`, {
    Authorization: `Basic ${basic}`,
    "Content-Type": "application/x-www-form-urlencoded",
  });
  const r = await fetch(url, { method: "POST", headers, body });
  if (!r.ok) {
    // Full upstream body stays in server logs only — never surfaced to the
    // client or persisted (gov.il bodies can carry internal detail).
    console.error("[tax-authority] token refresh failed", r.status, await r.text().catch(() => ""));
    throw new Error("פג תוקף החיבור לרשות המסים. חבר מחדש בהגדרות.");
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
  /** Issuer's עוסק/company number (digits only). */
  vatNumber: string;
  /** Human invoice number as printed on the document. */
  invoiceReferenceNumber: string;
  /** Customer's עוסק number (digits only); "0" when none (private customer). */
  customerVatNumber: string;
  invoiceDate: string;
  issuanceDate: string;
  amountBeforeDiscount: number;
  discount: number;
  paymentAmount: number;
  vatAmount: number;
  paymentAmountIncludingVat: number;
}

export interface AllocationResponse {
  /** The 9-digit allocation number to print on the invoice, or null on failure */
  allocationNumber: string | null;
  /** The full confirmation number returned by the Tax Authority, for audit. */
  confirmationNumber?: string;
  resultCode?: string;
  resultMessage?: string;
  raw: unknown;
}

export async function requestAllocation(
  accessToken: string,
  req: AllocationRequest,
): Promise<AllocationResponse> {
  // Israel Invoice "Israel Invoice Model" v2 (7/2024). The v2 single-Approval
  // body is flat (no Items), field names are lowercase, and the VAT numbers
  // are sent as NUMBERS (the published example showing strings is wrong — the
  // production swagger rejects strings with a type error). The allocation
  // number comes back as `confirmation_number`; print its 9 right-most digits.
  const body = {
    invoice_id: req.invoiceId,
    invoice_type: req.invoiceType,
    vat_number: parseInt(req.vatNumber, 10),
    invoice_reference_number: req.invoiceReferenceNumber,
    customer_vat_number: parseInt(req.customerVatNumber || "0", 10) || 0,
    invoice_date: req.invoiceDate,
    invoice_issuance_date: req.issuanceDate,
    accounting_software_number: SOFTWARE_NUMBER,
    amount_before_discount: req.amountBeforeDiscount,
    discount: req.discount,
    payment_amount: req.paymentAmount,
    vat_amount: req.vatAmount,
    payment_amount_including_vat: req.paymentAmountIncludingVat,
  };

  const { url, headers } = viaProxy(`${ITA_BASE}/Invoices/v2/Approval`, {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  });
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const raw = await r.json().catch(() => ({}));
  const asObj = (v: unknown): Record<string, unknown> | null =>
    typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  const obj = asObj(raw);

  // v2 rejection / gateway error message extraction. `message` is a string on
  // success ("Invoice approved") and may be an object with `errors[]` on a
  // business rejection; 4xx gateway errors use `moreInformation`.
  const extractMessage = (): string | undefined => {
    if (!obj) return undefined;
    const msg = obj.message;
    if (typeof msg === "string") return msg;
    const msgObj = asObj(msg);
    const errors = msgObj?.errors;
    if (Array.isArray(errors) && errors.length) {
      return errors.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("; ");
    }
    if (typeof obj.moreInformation === "string") return obj.moreInformation;
    return undefined;
  };

  const confirmation = obj?.confirmation_number ? String(obj.confirmation_number) : "";
  const approved = obj?.approved === true;

  if (!r.ok || !approved || !confirmation || confirmation === "0") {
    return {
      allocationNumber: null,
      confirmationNumber: confirmation || undefined,
      resultCode: String(obj?.status ?? r.status),
      resultMessage: extractMessage() || (r.ok ? "rejected" : "API error"),
      raw,
    };
  }

  return {
    // Print the 9 right-most digits on the invoice (Mispar Haktzaa).
    allocationNumber: confirmation.slice(-9),
    confirmationNumber: confirmation,
    resultCode: String(obj?.status ?? 200),
    resultMessage: extractMessage(),
    raw,
  };
}

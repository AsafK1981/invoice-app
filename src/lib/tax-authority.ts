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

/**
 * Normalize a customer's business/VAT number to digits only, treating an
 * empty value or an all-zeros placeholder ("000000000") as "no number"
 * (returns ""). This is how we tell a business customer (deducts input VAT)
 * apart from a private consumer (can't) for allocation-number purposes.
 */
export function normalizeCustomerVatNumber(v: unknown): string {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits && !/^0+$/.test(digits) ? digits : "";
}

/**
 * Does this document legally require a חשבונית ישראל allocation number
 * (מספר הקצאה)?
 *
 * The requirement only bites when the BUYER can deduct input VAT — i.e. a
 * business customer with a valid עוסק/ח.פ number. A PRIVATE customer (no
 * business number) can't deduct VAT, so חוק החשבוניות doesn't apply and no
 * allocation number is required, regardless of amount. Hence: no customer
 * number ⇒ not required.
 *
 * @param doc  partial document — type, date, pre-VAT amount, and clientTaxId.
 * @param customerTaxId optional override for the buyer's business number,
 *        already resolved by the caller (e.g. from the linked client). When
 *        omitted, falls back to doc.clientTaxId.
 */
export function requiresAllocationNumber(
  doc: InvoiceDocument,
  customerTaxId?: string | null,
): boolean {
  const isTaxDoc =
    doc.type === "tax_invoice" ||
    doc.type === "tax_invoice_receipt" ||
    doc.type === "credit_note";
  if (!isTaxDoc) return false;
  // B2C carve-out: a private customer (no valid business/VAT number) can't
  // deduct input VAT, so no allocation number is required no matter the sum.
  const customerNumber = normalizeCustomerVatNumber(customerTaxId ?? doc.clientTaxId);
  if (!customerNumber) return false;
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
  /**
   * ID (ת.ז) of the human user performing the allocation — the API's
   * `user_id` field (N9, mandatory unless `user_name` is sent). The v2 spec
   * (§Table 2.1, field 6) demands "the ID of the user performing the actual
   * allocation"; without it the gateway rejects with code 446 ("Requeried one
   * of the two fields: user ID or user name"). Our users are solo freelancers
   * (עוסק פטור/מורשה), so the operator == the business owner and the issuer's
   * own number is the correct identifier. Digits only; defaults to vatNumber.
   */
  userId?: string;
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
  // `user_id` (N9): the ID of the user performing the allocation. Mandatory
  // unless `user_name` is sent — the gateway returns code 446 without it. For
  // our solo-freelancer users the operator is the business owner, so we send
  // the issuer's own number (a 9-digit numeric, matching the N9 spec and the
  // "numbers not strings" convention above). See AllocationRequest.userId.
  const userId = (req.userId || req.vatNumber).replace(/\D/g, "");
  const body = {
    invoice_id: req.invoiceId,
    invoice_type: req.invoiceType,
    vat_number: parseInt(req.vatNumber, 10),
    user_id: parseInt(userId, 10),
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

  // Pull the most specific ITA error code out of the response. A flat 4xx
  // gateway error carries `code` at the top level (e.g. 446); a per-invoice
  // business rejection nests it under message.errors[].code; success carries
  // `status`.
  const extractCode = (): string | undefined => {
    if (!obj) return undefined;
    if (obj.code != null) return String(obj.code);
    const errs = asObj(obj.message)?.errors;
    if (Array.isArray(errs) && errs.length) {
      const first = asObj(errs[0]);
      if (first?.code != null) return String(first.code);
    }
    if (obj.status != null) return String(obj.status);
    return undefined;
  };

  // The raw English/technical `message` string, dug out of whichever shape the
  // response uses. Kept only as a fallback / for logs — never shown verbatim.
  const extractRawMessage = (): string | undefined => {
    if (!obj) return undefined;
    const msg = obj.message;
    if (typeof msg === "string") return msg;
    const errors = asObj(msg)?.errors;
    if (Array.isArray(errors) && errors.length) {
      return errors
        .map((e) => {
          const eo = asObj(e);
          return typeof e === "string" ? e : String(eo?.message ?? JSON.stringify(e));
        })
        .join("; ");
    }
    if (typeof obj.moreInformation === "string") return obj.moreInformation;
    return undefined;
  };

  const confirmation = obj?.confirmation_number ? String(obj.confirmation_number) : "";
  const approved = obj?.approved === true;

  if (!r.ok || !approved || !confirmation || confirmation === "0") {
    const resultCode = extractCode() ?? String(r.status);
    const rawMessage = extractRawMessage();
    // Full upstream body (may carry gov.il internal detail) stays in server
    // logs only — never surfaced to the client as a raw JSON blob.
    console.error(
      "[tax-authority] allocation rejected",
      "http=", r.status,
      "code=", resultCode,
      "raw=", JSON.stringify(raw),
    );
    return {
      allocationNumber: null,
      confirmationNumber: confirmation || undefined,
      resultCode,
      // A clean, human Hebrew reason — mapped from the ITA code where known,
      // otherwise a generic line. The technical English string is dropped.
      resultMessage: hebrewForItaCode(resultCode, rawMessage),
      raw,
    };
  }

  return {
    // Print the 9 right-most digits on the invoice (Mispar Haktzaa).
    allocationNumber: confirmation.slice(-9),
    confirmationNumber: confirmation,
    resultCode: String(obj?.status ?? 200),
    resultMessage: undefined,
    raw,
  };
}

/**
 * Map an Israel-Tax-Authority error code to a concise, user-facing Hebrew
 * reason. The gateway/business messages come back in technical English (or a
 * JSON blob), which reads terribly inside our RTL Hebrew card — so we translate
 * the codes we know and fall back to a generic Hebrew line for the rest. The
 * raw English is never shown to the user (it stays in server logs).
 */
export function hebrewForItaCode(code: string | undefined, _rawMessage?: string): string {
  switch (code) {
    case "446":
      return "חסר שדה מזהה משתמש (ת.ז מבצע ההקצאה) בבקשה";
    case "460":
      return "החשבונית לא אושרה על ידי רשות המסים";
    case "461":
      return "פרטי החשבונית אינם תקינים";
    case "462":
      return "קיימת כבר החלטה עבור חשבונית זו";
    case "401":
    case "403":
      return "החיבור לרשות המסים אינו מורשה — חבר מחדש בהגדרות";
    default:
      return "הבקשה נדחתה על ידי רשות המסים";
  }
}

import { PLANS, type PlanTier, type BillingInterval } from "./plans";

/**
 * Tranzila clearing client — Israeli direct card processor (Interspace /
 * Tranzila, terminal-based). Written 2026-07-31 per Asaf's explicit approval
 * to author the module without opening a merchant account or spending
 * anything: PAYMENT_PROVIDER stays unset in every real environment until he
 * signs, so nothing here runs today.
 *
 * ── Why the legacy "Low Profile" CGI flow, not the newer JSON API v2 ───────
 * Tranzila has two integration generations: (a) the decades-old form-encoded
 * CGI endpoints (tranzila71u.cgi et al.) with a hosted "Low Profile" iframe
 * page that mints a reusable TranzilaTK token, and (b) a newer JSON API v2
 * (HMAC-signed headers, direct.tranzila.com) built mainly for their Bit /
 * standing-order products. docs.tranzila.com's own pages for API v2 and the
 * iframe integration returned "not indexed" when fetched 2026-07-31 — there
 * is no authoritative current spec to build against. The legacy CGI flow is
 * what Michal (Tranzila sales, 2026-07-28/29 email thread, ticket #342663638)
 * confirmed by name — "עמוד תשלום מתארח / iframe (Low Profile) שיוצר טוקן
 * בתשלום הראשון... כן פלואו תקין" — and it's the flow every long-running
 * third-party integration (WooCommerce/Magento plugins, Ruby ActiveMerchant,
 * PHP Omnipay, the community `tranzilajs` wrapper) targets, so it is by far
 * the better-documented, more stable choice for a from-scratch build.
 *
 * TODO(verify against Tranzila's live docs / sandbox once terminal creds
 * exist): every field below marked TODO. None of this has been exercised
 * against a real Tranzila terminal — Asaf's demo login (sales@interspace.net)
 * is for their merchant back-office UI, not API access; a real terminal name
 * + password are still needed from the vendor (see docs/payments/
 * tranzila-integration.md for exactly what to ask for).
 *
 * Sources consulted 2026-07-31 (WebSearch + WebFetch, all public):
 *   - https://docs.tranzila.com/ (portal hub only; sub-pages not indexed)
 *   - https://github.com/astrails/active_merchant_tranzila (Ruby gateway,
 *     confirms tranzila71u.cgi/tranzila31.cgi params + "Response"==="000")
 *   - https://github.com/NirTatcher/tranzilajs (Node wrapper; confirms the
 *     card/token/standing-order shape used by the newer API, for context)
 *   - Michal's emails (Tranzila sales) confirming the hosted iframe/token
 *     flow is valid and that CVV-less recurring needs terminal approval.
 */

// TODO(verify): confirmed by two independent third-party integrations
// (ActiveMerchant, community search results) as the live legacy charge/token
// endpoint. Region/currency variants exist (tranzila31.cgi for ILS/USD,
// tranzila36a.cgi for other currencies) — we only ever charge ILS, so this
// single endpoint should be correct, but has not been hit against a real
// terminal.
const TRANZILA_CHARGE_BASE = "https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi";

// TODO(verify): the hosted "Low Profile" iframe page that mints a TranzilaTK
// token. The {terminal} path segment convention is inferred from Tranzila's
// well-known iframe pattern (direct.tranzila.com/{supplier}/...); the exact
// page name and required query params (which flag requests "issue a token,
// don't charge yet" vs "charge and issue a token") were NOT confirmed from
// any fetched source and MUST be confirmed with Tranzila support/docs before
// this URL is used for a real checkout.
function tranzilaIframeBase(terminal: string): string {
  return `https://direct.tranzila.com/${terminal}/iframenew.cgi`;
}

const TRANZILA_TERMINAL = process.env.TRANZILA_TERMINAL || "";
// TranzilaPW ("transaction password"). Per Michal + third-party docs, this
// must NOT be sent when the hosted iframe issues the FIRST token (that page
// is itself the trusted context); it IS required for the later
// server-to-server charge-by-token call, which is the only place this module
// sends it.
const TRANZILA_PASSWORD = process.env.TRANZILA_PASSWORD || "";

/**
 * ILS currency code. Confirmed identically by two independent sources
 * (ActiveMerchant gateway comments + a Tranzila iframe integration summary):
 * numeric "1" = Israeli Shekel in Tranzila's convention. This is the one
 * numeric constant in this file NOT marked TODO.
 */
const TRANZILA_CURRENCY_ILS = "1";

/**
 * True iff the minimum Tranzila credentials are present. Mirrors
 * isGrowConfigured()/isPolarConfigured() — every caller must gate on this
 * before touching the network, so a missing env var fails closed (503) at
 * the API route rather than sending a malformed request.
 */
export function isTranzilaConfigured(): boolean {
  return !!TRANZILA_TERMINAL && !!TRANZILA_PASSWORD;
}

/** Thrown on network/transport failure talking to Tranzila (not on a business
 * error inside a 200 response; those are returned in the parsed body). */
export class TranzilaApiError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TranzilaApiError";
  }
}

/** Shape returned by every low-level call: the parsed form-encoded body plus
 * the raw text, so callers/logs can inspect real responses while field-name
 * assumptions are still being confirmed against a live terminal. */
export interface TranzilaRawResponse {
  parsed: Record<string, string>;
  raw: string;
  status: number;
}

/**
 * Low-level form-encoded POST to the Tranzila CGI endpoint. Tranzila's
 * classic API replies form-encoded (key=value&key=value), NOT JSON — parsed
 * defensively the same way grow.ts parses Grow's ambiguous content-type.
 */
async function tranzilaApiCall(
  params: Record<string, string>,
): Promise<TranzilaRawResponse> {
  if (!isTranzilaConfigured()) {
    throw new TranzilaApiError(
      "Tranzila is not configured (TRANZILA_TERMINAL / TRANZILA_PASSWORD missing)",
    );
  }

  const body = new URLSearchParams({
    supplier: TRANZILA_TERMINAL,
    TranzilaPW: TRANZILA_PASSWORD,
    currency: TRANZILA_CURRENCY_ILS,
    ...params,
  });

  let res: Response;
  try {
    res = await fetch(TRANZILA_CHARGE_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new TranzilaApiError("Network error calling Tranzila", err);
  }

  const raw = await res.text();
  const parsed: Record<string, string> = {};
  try {
    const sp = new URLSearchParams(raw);
    for (const [k, v] of sp.entries()) parsed[k] = v;
  } catch {
    // leave parsed empty; raw is still returned for inspection
  }

  // Log the raw response so developers can inspect real Tranzila responses
  // while field-name assumptions are still being confirmed. NEVER log
  // TranzilaPW/TranzilaTK — the request params, not the response, carry
  // those, and only the response is logged here.
  console.log(`[tranzila] charge -> ${res.status}`, raw);

  return { parsed, raw, status: res.status };
}

export interface CreateHostedPaymentOpts {
  /** Charge amount (NIS) for the FIRST payment. Use TOKEN_VALIDATION_AMOUNT
   * for a trial (token-only, minimal-charge) start. */
  sum: number;
  /** Browser redirect after success (user-facing). */
  successUrl: string;
  /** Browser redirect after failure/cancel (user-facing). */
  failUrl: string;
  fullName: string;
  email: string;
  phone: string;
}

/**
 * Builds the redirect URL to Tranzila's hosted "Low Profile" iframe/payment
 * page, where the customer enters card details directly on Tranzila's domain
 * (never touching our server) and Tranzila mints a reusable TranzilaTK token.
 *
 * TODO(verify against Tranzila's live docs / sandbox): this function returns
 * a BEST-GUESS URL shape. The exact query parameter names for (a) requesting
 * token issuance, (b) the success/fail redirect fields, and (c) whether the
 * token comes back as a URL query param on the successUrl redirect or must be
 * read from a separate server-to-server notify call, are UNCONFIRMED. Do not
 * point real traffic at this until confirmed with Tranzila support using the
 * real terminal credentials — this is scaffolding, not a tested integration.
 */
export function buildHostedPaymentUrl(opts: CreateHostedPaymentOpts): string {
  if (!isTranzilaConfigured()) {
    throw new TranzilaApiError(
      "Tranzila is not configured (TRANZILA_TERMINAL / TRANZILA_PASSWORD missing)",
    );
  }

  const params = new URLSearchParams({
    sum: String(opts.sum),
    currency: TRANZILA_CURRENCY_ILS,
    cred_type: "1", // TODO(verify): "1" = regular charge, per third-party docs
    success_url_address: opts.successUrl,
    fail_url_address: opts.failUrl,
    contact: opts.fullName,
    email: opts.email,
    phone: opts.phone,
    // TODO(verify): the flag that tells Tranzila's hosted page to issue a
    // reusable token (vs. a one-off charge with no token). Third-party docs
    // reference a "TranzilaTK=1" request-side flag for this purpose on some
    // integrations; unconfirmed for the current hosted-page product.
    TranzilaTK: "1",
  });

  return `${tranzilaIframeBase(TRANZILA_TERMINAL)}?${params.toString()}`;
}

export interface ChargeTokenOpts {
  /** The saved TranzilaTK token from a prior hosted-page payment. */
  token: string;
  /** Charge amount (NIS). */
  sum: number;
}

/**
 * Charges a previously saved TranzilaTK token via the CGI charge endpoint,
 * fully server-to-server (no customer interaction, no CVV — this is exactly
 * the "recurring/subsequent transaction" case Michal confirmed needs the
 * terminal approved for CVV-less charging).
 *
 * Success detection: `Response === "000"` is the one response convention
 * confirmed by an independent third-party gateway implementation
 * (active_merchant_tranzila) reading the real CGI response. `ConfirmationCode`
 * is the authorization number (kept as transactionId); `index` is the
 * per-transaction sequence number Tranzila requires for a later refund —
 * BOTH are returned here so the caller can persist `index` if it plans to
 * ever refund this specific charge.
 */
export async function chargeToken(
  opts: ChargeTokenOpts,
): Promise<{ raw: TranzilaRawResponse; success: boolean; transactionId?: string; index?: string }> {
  const raw = await tranzilaApiCall({
    TranzilaTK: opts.token,
    sum: String(opts.sum),
    cred_type: "1", // TODO(verify): "1" = regular charge
  });

  const success = raw.parsed.Response === "000";
  return {
    raw,
    success,
    transactionId: raw.parsed.ConfirmationCode || undefined,
    index: raw.parsed.index || undefined,
  };
}

export interface RefundOpts {
  /** The `index` field returned by the original chargeToken() response. */
  index: string;
  /** The `transactionId` (ConfirmationCode) returned by the original charge. */
  authnr: string;
  sum: number;
}

/**
 * Refunds/cancels a prior charge. Confirmed shape (active_merchant_tranzila):
 * `tranmode` is set to `C<index>` (the literal letter C followed by the
 * original transaction's index number), plus the original `authnr`
 * (ConfirmationCode). TODO(verify): exercise against a real sandbox charge
 * before relying on this for a real refund.
 */
export async function refundTransaction(
  opts: RefundOpts,
): Promise<{ raw: TranzilaRawResponse; success: boolean }> {
  const raw = await tranzilaApiCall({
    tranmode: `C${opts.index}`,
    authnr: opts.authnr,
    sum: String(opts.sum),
  });

  const success = raw.parsed.Response === "000";
  return { raw, success };
}

/**
 * Price for a (tier, interval) in NIS, sourced from PLANS (never duplicated
 * here). Mirrors grow.ts's getPlanPrice() exactly.
 */
export function getPlanPrice(tier: PlanTier, interval: BillingInterval): number {
  const plan = PLANS[tier];
  return interval === "year" ? plan.priceYearly : plan.priceMonthly;
}

/**
 * The nominal charge (NIS) used to tokenize a card at the START of a trial —
 * mirrors grow.ts's TOKEN_VALIDATION_AMOUNT exactly, same rationale (card
 * networks generally reject a genuine ₪0 authorization). TODO(verify against
 * Tranzila support): whether their hosted page supports a true ₪0
 * tokenization-only mode instead: it directly affects trial UX (the user
 * should not be meaningfully charged during a "free" trial), so it's worth
 * asking before this ships.
 */
export const TOKEN_VALIDATION_AMOUNT = 1;

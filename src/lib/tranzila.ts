import crypto from "node:crypto";
import { PLANS, type PlanTier, type BillingInterval } from "./plans";

/**
 * Tranzila clearing client — Israeli direct card processor (Interspace /
 * Tranzila, terminal-based). Originally written 2026-07-31 per Asaf's explicit
 * approval to author the module without opening a merchant account or
 * spending anything; PAYMENT_PROVIDER stays unset in every real environment
 * until he signs, so nothing here runs today.
 *
 * ── Rebuilt 2026-08-05 against docs.tranzila.com (now live) ────────────────
 * The 2026-07-31 version was written entirely from third-party guesswork
 * (community gateways, not Tranzila's own docs) because docs.tranzila.com
 * returned "not indexed" at the time. As of 2026-08-05 the official developer
 * guide is live (https://docs.tranzila.com/) and was crawled in full:
 *   - Payments & Billing → Authentication, Tranzila API (OpenAPI v1 spec,
 *     downloaded and read in full), Iframe Integration new DirectNG, Hosted
 *     Fields, STO API v2 (My Billing), Transaction Response Codes, Quickstart.
 * Every TODO(verify) below that could be resolved from these pages has been;
 * the ones that remain state exactly what live-terminal test or vendor
 * answer they're waiting on.
 *
 * ── Why the hosted-page redirect flow (DirectNG iframe), not Hosted Fields ─
 * Tranzila offers three ways to capture a card:
 *   1. **DirectNG hosted iframe/redirect** (what this module uses) — POST/GET
 *      the transaction fields to `https://directng.tranzila.com/{terminal}/
 *      iframenew.php`; the customer enters card details entirely on
 *      Tranzila's PCI-DSS-certified page (embedded in our iframe or a full
 *      redirect); Tranzila POSTs/redirects the result back to our
 *      success_url_address/fail_url_address. This is a straight evolution of
 *      the "Low Profile" flow the 2026-07-31 version targeted from
 *      third-party sources — same response field names (`Response`,
 *      `TranzilaTK`, `sum`, `currency`, `index`), just a new documented URL.
 *      Confirmed: https://docs.tranzila.com/docs/payments-and-billing/iframe-integration-directng
 *   2. **Hosted Fields** — embeds Tranzila's `thostedf.js` and renders the
 *      card inputs as styled iframes inside OUR OWN payment form, charged via
 *      a client-side `fields.charge()` call that requires a server-generated
 *      "handshake" token first. More customizable UI, but meaningfully more
 *      integration surface (our own form markup, the handshake endpoint, a
 *      client-side charge callback) for a inert/opt-in provider with zero
 *      paying subscribers today. Confirmed:
 *      https://docs.tranzila.com/docs/payments-and-billing/hosted-fields
 *   3. **JSON API v1** (`api.tranzila.com/v1`, HMAC-signed headers) —
 *      documented, but `/transaction/credit_card/create` takes a raw
 *      `card_number` (not a saved token) for a debit/credit/cancel; it's a
 *      server-to-server "charge a card you already have on the wire" API, not
 *      a hosted card-capture page. Used below ONLY for `refundTransaction()`.
 * DECISION: keep the DirectNG hosted redirect for card capture (#1) — it's
 * the simplest integration (no PCI-adjacent card-handling code of our own),
 * it's what the 2026-07-31 version already targeted, and it's now backed by
 * an authoritative, current doc page rather than third-party inference.
 * Hosted Fields is a legitimate future upgrade if a fully-embedded (no
 * cross-domain iframe) UI is wanted later, not a reason to redo this now.
 *
 * ── The one piece still genuinely unresolved ────────────────────────────
 * Charging a SAVED TranzilaTK token later (our own subscription-billing cron,
 * no customer interaction) is, per the current docs, only available through
 * Tranzila's own paid **My Billing / STO v2** module (₪80/mo, deliberately
 * excluded — see docs/payments/tranzila-integration.md). No free/DIY
 * "charge this existing token for ₪X now" REST endpoint is documented
 * anywhere in the Payments & Billing section as of 2026-08-05. `chargeToken()`
 * below reflects that honestly (throws, does not guess) rather than shipping
 * a call to an endpoint nobody has confirmed exists outside My Billing.
 */

// ── DirectNG hosted iframe (card capture) ──────────────────────────────────
// CONFIRMED 2026-08-05: https://docs.tranzila.com/docs/payments-and-billing/iframe-integration-directng
// "The new URL to use is: https://directng.tranzila.com/terminalname/iframenew.php"
// (superseding the old direct.tranzila.com/terminalname/iframenew.php, and
// entirely different from the tranzila71u.cgi / iframenew.cgi paths the
// 2026-07-31 version guessed from third-party sources).
function tranzilaIframeBase(terminal: string): string {
  return `https://directng.tranzila.com/${terminal}/iframenew.php`;
}

// ── JSON API v1 (used only for refundTransaction() below) ──────────────────
// CONFIRMED 2026-08-05: server URL in the official OpenAPI v1 spec served
// from https://docs.tranzila.com/docs/payments-and-billing/tranzila-api
// ("servers: - url: https://api.tranzila.com/v1").
const TRANZILA_API_V1_BASE = "https://api.tranzila.com/v1";

const TRANZILA_TERMINAL = process.env.TRANZILA_TERMINAL || "";
// TranzilaPW ("transaction password"). NOTE: the DirectNG hosted-iframe
// parameter table (linked above) does NOT list a supplier/TranzilaPW field
// at all — the terminal name is embedded in the URL path and nothing else is
// required to open the hosted page. TRANZILA_PASSWORD is kept as a required
// config gate anyway (isTranzilaConfigured() fails closed without it) purely
// as a defensive default until the still-undocumented recurring-charge-by-
// token path (see chargeToken() below) is confirmed with Tranzila support —
// at that point it will either turn out to need TranzilaPW (legacy
// convention) or nothing at all.
const TRANZILA_PASSWORD = process.env.TRANZILA_PASSWORD || "";

// JSON API v1 HMAC credentials — NEW as of the 2026-08-05 rebuild. The
// legacy TranzilaPW convention has nothing to do with the JSON API; API v1
// authenticates every request with 4 headers (app key, unix request time, a
// 40-byte nonce, and an HMAC-SHA256 access token), confirmed here:
// https://docs.tranzila.com/docs/payments-and-billing/authentication
const TRANZILA_APP_KEY = process.env.TRANZILA_APP_KEY || "";
const TRANZILA_APP_SECRET = process.env.TRANZILA_APP_SECRET || "";

/**
 * ILS currency code for the DirectNG hosted-iframe `currency` field.
 * CONFIRMED 2026-08-05 (iframe-integration-directng parameter table):
 * "currency ... 1 - NIS, 2 - US dollar, 978 - Euro, 826 - Pound Sterling GBP".
 */
const TRANZILA_CURRENCY_ILS = "1";

/**
 * True iff the minimum Tranzila credentials are present. Mirrors
 * isGrowConfigured()/isPolarConfigured() — every caller must gate on this
 * before touching the network, so a missing env var fails closed (503) at
 * the API route rather than sending a malformed request.
 *
 * TRANZILA_APP_KEY/TRANZILA_APP_SECRET are intentionally NOT required here:
 * they're only needed by refundTransaction() (JSON API v1), and gating the
 * entire checkout flow on them would be stricter than what building the
 * hosted redirect URL actually needs.
 */
export function isTranzilaConfigured(): boolean {
  return !!TRANZILA_TERMINAL && !!TRANZILA_PASSWORD;
}

/** Thrown on network/transport failure talking to Tranzila, OR when a caller
 * hits a code path that requires config this module does not have (e.g.
 * refundTransaction() without TRANZILA_APP_KEY/SECRET). Not thrown for a
 * business-logic decline inside a 200 response; those come back in the
 * parsed body. */
export class TranzilaApiError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TranzilaApiError";
  }
}

/** Shape returned by a low-level JSON API v1 call. */
export interface TranzilaRawResponse {
  parsed: Record<string, unknown>;
  raw: string;
  status: number;
}

/**
 * Builds the 4 HMAC authentication headers required by every JSON API v1
 * call. CONFIRMED 2026-08-05 against the identical formula given in 4
 * independent language examples (PHP, Node, Python, .NET) on
 * https://docs.tranzila.com/docs/payments-and-billing/authentication — all
 * four compute the SAME thing despite the prose description reading
 * ambiguously ("hash_hmac using 'sha256' on application key with secret +
 * request-time + nonce"): the HMAC **key** is `secret + requestTime + nonce`
 * concatenated, and the **message** being signed is the app key itself.
 * (e.g. PHP: `hash_hmac('sha256', $appKey, $secret . $time . $nonce)` — in
 * PHP's `hash_hmac(algo, data, key)` signature, `data` is $appKey and `key`
 * is the secret+time+nonce string.)
 */
function tranzilaApiV1Headers(): Record<string, string> {
  if (!TRANZILA_APP_KEY || !TRANZILA_APP_SECRET) {
    throw new TranzilaApiError(
      "Tranzila JSON API v1 is not configured (TRANZILA_APP_KEY / TRANZILA_APP_SECRET missing)",
    );
  }
  const requestTime = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(40).toString("hex");
  const accessToken = crypto
    .createHmac("sha256", TRANZILA_APP_SECRET + requestTime + nonce)
    .update(TRANZILA_APP_KEY)
    .digest("hex");

  return {
    "X-tranzila-api-app-key": TRANZILA_APP_KEY,
    "X-tranzila-api-request-time": requestTime,
    "X-tranzila-api-nonce": nonce,
    "X-tranzila-api-access-token": accessToken,
  };
}

/**
 * Low-level authenticated POST to a JSON API v1 endpoint (used only by
 * refundTransaction() today). Unlike the old CGI-era assumption, API v1
 * replies with real JSON, not form-encoded text.
 */
async function tranzilaApiV1Call(
  path: string,
  body: Record<string, unknown>,
): Promise<TranzilaRawResponse> {
  const headers = {
    "Content-Type": "application/json",
    ...tranzilaApiV1Headers(),
  };

  let res: Response;
  try {
    res = await fetch(`${TRANZILA_API_V1_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new TranzilaApiError("Network error calling Tranzila API v1", err);
  }

  const raw = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // leave parsed empty; raw is still returned for inspection
  }

  // Log the raw response so developers can inspect real Tranzila responses.
  // NEVER log the HMAC headers or app secret — only the response is logged.
  console.log(`[tranzila] API v1 ${path} -> ${res.status}`, raw);

  return { parsed, raw, status: res.status };
}

export interface CreateHostedPaymentOpts {
  /** Charge amount (NIS) — see `tokenOnly` below for what this means when a
   * trial/token-only checkout is in progress. */
  sum: number;
  /** Browser redirect after success (user-facing). Tranzila POSTs/redirects
   * the full transaction result here, including `TranzilaTK` — see the
   * "How the token comes back" note below. */
  successUrl: string;
  /** Browser redirect after failure/cancel (user-facing). */
  failUrl: string;
  fullName: string;
  email: string;
  phone: string;
  /**
   * True for a first-time trial checkout where we only want a saved card
   * token, no real charge. Selects `tranmode=N` (SHVA J2 "checks card")
   * instead of `tranmode=A` (standard debit) — see TOKEN_VALIDATION_AMOUNT
   * for why `sum` is still sent as a positive number even in this mode.
   */
  tokenOnly?: boolean;
}

/**
 * Builds the redirect URL to Tranzila's DirectNG hosted iframe/payment page,
 * where the customer enters card details directly on Tranzila's domain
 * (never touching our server) and Tranzila mints a reusable TranzilaTK
 * token.
 *
 * ── How the token comes back (CONFIRMED, no server round trip needed) ──────
 * Per https://docs.tranzila.com/docs/payments-and-billing/iframe-integration-directng
 * ("Data Retrieval"): after the transaction completes, Tranzila POSTs/
 * redirects (customer's browser, GET or POST — POST is what we request via
 * `success_url_address`/`fail_url_address`) the FULL transaction result,
 * including `TranzilaTK`, `Response`, `sum`, `currency`, `index`, `ccno`,
 * `cardtype`, directly to the successUrl we pass here. There is a SEPARATE,
 * OPTIONAL `notify_url_address` field for a simultaneous server-to-server
 * copy of the same payload ("If a Notify page is configured, the transaction
 * data will also be sent to it simultaneously") — useful as a
 * tamper/reliability backstop, but not required to obtain the token.
 * CONCLUSION: a callback ROUTE is still needed (to receive and parse the
 * POST to successUrl and persist the token + activate the plan), but it does
 * NOT need to be a dedicated Tranzila-initiated server callback distinct
 * from the browser's own return trip — unlike Grow, there is no separate
 * "create a payment process, then poll/callback" step. This callback route
 * is NOT built yet (see docs/payments/tranzila-integration.md).
 */
export function buildHostedPaymentUrl(opts: CreateHostedPaymentOpts): string {
  if (!isTranzilaConfigured()) {
    throw new TranzilaApiError(
      "Tranzila is not configured (TRANZILA_TERMINAL / TRANZILA_PASSWORD missing)",
    );
  }

  // CONFIRMED 2026-08-05 (iframe-integration-directng "tranmode" parameter
  // table): tranmode=A is a standard debit; tranmode=N is SHVA "J2 - Checks
  // Card" verification, which validates the card WITHOUT capturing funds
  // (contrast with tranmode=V, "J5", which explicitly "takes credit limit on
  // the amount specified" — i.e. only V holds funds; N does not). `sum` is
  // still required as a positive number in N-mode (the field's stated type
  // is "Positive Decimal Number" with no zero/empty carve-out, and the
  // `hidesum` parameter — which explicitly exists to hide `sum` from the
  // customer "only if ... tranmode=V or tranmode=K or tranmode=N" — implies
  // `sum` is still transmitted, just not charged, in this mode). This is why
  // TOKEN_VALIDATION_AMOUNT stays a positive ₪1 rather than becoming 0: the
  // number satisfies the field's format requirement, but tranmode=N means it
  // is never actually captured from the card.
  const tranmode = opts.tokenOnly ? "N" : "A";

  const params = new URLSearchParams({
    sum: String(opts.sum),
    currency: TRANZILA_CURRENCY_ILS,
    tranmode,
    cred_type: "1", // CONFIRMED: "1" = one payment (default), per the iframe parameter table
    success_url_address: opts.successUrl,
    fail_url_address: opts.failUrl,
    contact: opts.fullName,
    email: opts.email,
    phone: opts.phone,
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
 * NOT IMPLEMENTED — intentionally throws rather than guessing.
 *
 * Charging a previously saved TranzilaTK token, server-to-server, with no
 * customer interaction, is required for our own `subscription-billing` cron
 * to renew a subscription without My Billing. As of the 2026-08-05 doc crawl
 * this is genuinely NOT documented anywhere in the Payments & Billing
 * section outside the paid My Billing / STO v2 module:
 *   - JSON API v1's `/transaction/credit_card/create` (the only
 *     server-to-server charge endpoint in the OpenAPI spec) takes a raw
 *     `card_number` + `expire_month` + `expire_year`, NOT a saved token —
 *     there is no `token` field in `transactionCreditCardCreate`.
 *   - STO v2's `/sto/create` DOES accept `card.token`, but the entire STO
 *     module is explicitly gated as a paid module ("This is a paid module.
 *     Please contact sales to use this module.") — the ₪80/mo My Billing
 *     add-on we deliberately excluded (see
 *     docs/payments/tranzila-integration.md).
 * The pre-2026-08-05 version of this function guessed at reusing the legacy
 * CGI charge convention (TranzilaTK + TranzilaPW posted to
 * tranzila71u.cgi) based on third-party gateway source code, not Tranzila's
 * own docs — that guess is removed rather than kept, because shipping a call
 * to an endpoint nobody has confirmed still exists is worse than clearly
 * blocking here.
 *
 * TODO(verify): ask Tranzila support/sales directly — "does our server have
 * any way to charge a previously-issued TranzilaTK token for a set amount,
 * without the My Billing module, and if so what is the exact endpoint and
 * required parameters?" If the answer is "no, only via My Billing", the real
 * choice becomes: pay for My Billing (₪80/mo, on top of the ₪120/mo MINI ALL
 * IN ONE terminal), or re-collect card details every renewal (bad UX), or
 * pick a different processor for recurring billing specifically.
 */
export async function chargeToken(_opts: ChargeTokenOpts): Promise<never> {
  throw new TranzilaApiError(
    "chargeToken() is not implemented: no documented free/DIY endpoint exists to charge a " +
      "saved TranzilaTK token outside Tranzila's paid My Billing module. See the TODO(verify) " +
      "in src/lib/tranzila.ts and docs/payments/tranzila-integration.md before building this.",
  );
}

export interface RefundOpts {
  /** The Tranzila internal transaction id from the original charge's
   * DirectNG redirect response (`transaction_id` / `index` field). */
  referenceTransactionId: string;
  /** The authorization number from the original charge's redirect response. */
  authorizationNumber: string;
  terminalName: string;
}

/**
 * Cancels/voids a prior charge via JSON API v1's documented `cancel`
 * transaction type. CONFIRMED 2026-08-05 against the official OpenAPI v1
 * spec (`/transaction/credit_card/create`, `txn_type` enum includes
 * `cancel`, code example: `{"terminal_name": ..., "txn_type": "cancel",
 * "reference_txn_id": 12345, "authorization_number": "0000000"}` — no card
 * data required for `cancel`, unlike `credit` which re-requires a full card
 * number).
 *
 * Success detection: `error_code === 0` at the top level (API v1's own
 * convention — NOT the legacy `Response === "000"` used by the DirectNG
 * hosted-page redirect). The nested `transaction_result.processor_response_code`
 * mirrors the same SHVA codes as the redirect flow's `Response` field for
 * additional detail.
 *
 * TODO(verify against a live sandbox terminal): whether `cancel` works for a
 * transaction from a prior day, or is restricted to same-day voids (SHVA
 * same-day-void windows are the norm across Israeli processors — Tranzila's
 * own docs don't state a time limit for `cancel`). If `cancel` is same-day
 * only, a genuine multi-day refund would need `txn_type: credit`, which per
 * the spec's own code example requires re-submitting full card data
 * (card_number/expire_month/expire_year/cvv) — something we deliberately do
 * NOT store (we only keep the TranzilaTK token). Ask Tranzila support
 * directly whether `credit` can reference a token instead of raw card data.
 */
export async function refundTransaction(
  opts: RefundOpts,
): Promise<{ raw: TranzilaRawResponse; success: boolean }> {
  const raw = await tranzilaApiV1Call("/transaction/credit_card/create", {
    terminal_name: opts.terminalName,
    txn_type: "cancel",
    reference_txn_id: opts.referenceTransactionId,
    authorization_number: opts.authorizationNumber,
  });

  const errorCode = raw.parsed.error_code;
  const success = errorCode === 0 || errorCode === "0";
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
 * The nominal amount (NIS) sent in the `sum` field of a trial/token-only
 * hosted-page checkout. NOT actually captured from the card in that case —
 * see the `tranmode` comment in buildHostedPaymentUrl() for why: DirectNG's
 * `tranmode=N` (SHVA "J2 - Checks Card") verifies the card without taking
 * funds, but the `sum` field itself is documented as a required "Positive
 * Decimal Number" with no zero-value carve-out, so a positive placeholder
 * must still be sent. TODO(verify on first live sandbox test): confirm that
 * tranmode=N genuinely results in a ₪0 statement impact (the docs describe
 * it as "checks card" in contrast to tranmode=V which explicitly "takes
 * credit limit" — strongly implying no capture — but this has not been
 * exercised against a real terminal).
 */
export const TOKEN_VALIDATION_AMOUNT = 1;

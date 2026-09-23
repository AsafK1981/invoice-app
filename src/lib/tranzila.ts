import crypto from "node:crypto";
import { PLANS, type PlanTier, type BillingInterval } from "./plans";

/**
 * Tranzila clearing client - Israeli direct card processor (Interspace /
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
 *   1. **DirectNG hosted iframe/redirect** (what this module uses) - POST/GET
 *      the transaction fields to `https://directng.tranzila.com/{terminal}/
 *      iframenew.php`; the customer enters card details entirely on
 *      Tranzila's PCI-DSS-certified page (embedded in our iframe or a full
 *      redirect); Tranzila POSTs/redirects the result back to our
 *      success_url_address/fail_url_address. This is a straight evolution of
 *      the "Low Profile" flow the 2026-07-31 version targeted from
 *      third-party sources - same response field names (`Response`,
 *      `TranzilaTK`, `sum`, `currency`, `index`), just a new documented URL.
 *      Confirmed: https://docs.tranzila.com/docs/payments-and-billing/iframe-integration-directng
 *   2. **Hosted Fields** - embeds Tranzila's `thostedf.js` and renders the
 *      card inputs as styled iframes inside OUR OWN payment form, charged via
 *      a client-side `fields.charge()` call that requires a server-generated
 *      "handshake" token first. More customizable UI, but meaningfully more
 *      integration surface (our own form markup, the handshake endpoint, a
 *      client-side charge callback) for a inert/opt-in provider with zero
 *      paying subscribers today. Confirmed:
 *      https://docs.tranzila.com/docs/payments-and-billing/hosted-fields
 *   3. **JSON API v1** (`api.tranzila.com/v1`, HMAC-signed headers) -
 *      documented, but `/transaction/credit_card/create` takes a raw
 *      `card_number` (not a saved token) for a debit/credit/cancel; it's a
 *      server-to-server "charge a card you already have on the wire" API, not
 *      a hosted card-capture page. Used below ONLY for `refundTransaction()`.
 * DECISION: keep the DirectNG hosted redirect for card capture (#1) - it's
 * the simplest integration (no PCI-adjacent card-handling code of our own),
 * it's what the 2026-07-31 version already targeted, and it's now backed by
 * an authoritative, current doc page rather than third-party inference.
 * Hosted Fields is a legitimate future upgrade if a fully-embedded (no
 * cross-domain iframe) UI is wanted later, not a reason to redo this now.
 *
 * ── RESOLVED 2026-09-23: saved-token charging needs no paid module ────────
 * The paragraph that stood here until 2026-09-23 said charging a saved
 * TranzilaTK server-to-server was undocumented outside the paid My Billing /
 * STO v2 module, and `chargeToken()` threw rather than guess. Tranzila
 * support answered that question in writing on 2026-09-23, and the
 * `create a credit card transaction` doc page was rewritten to say the same
 * thing in its own "Recommended Integration Workflow" section:
 *
 *   "A Tranzila token replaces only the full card number. It does not
 *    include the card expiry date, CVV, cardholder details, or any other
 *    customer data. When required, those values must still be sent together
 *    with the token. [...] Submit the transaction using the token in the
 *    card_number field."
 *   - https://docs.tranzila.com/docs/payments-and-billing/tranzila-transactions-api-1/create-a-credit-card-transaction
 *
 * So the SAME JSON API v1 endpoint already used by refundTransaction()
 * (`POST /transaction/credit_card/create`, HMAC-signed with the 4
 * X-tranzila-api-* headers) charges a saved token: the token simply goes in
 * `card_number`, alongside `expire_month` / `expire_year`, `terminal_name`,
 * `txn_type` and `items[]`. My Billing / STO v2 is NOT needed and must not
 * be used - that module is for Tranzila-run standing orders, a different
 * product from "our cron charges ₪X against this token now".
 *
 * Note the doc page inverts the old reading of this endpoint: sending a raw
 * PAN here is now the restricted path ("permitted only for PCI DSS-certified
 * integrations"), and the token is the RECOMMENDED input. We never hold a
 * PAN, so we are on the recommended path by construction.
 *
 * ── PROVEN LIVE 2026-09-23 (supersedes the two caveats that stood here) ────
 * The header used to say "nothing here has ever been run against a live
 * terminal" and "we do not know where the card expiry comes from". BOTH ARE
 * NOW FALSE, and they were corrected the same day they were disproved:
 *
 *  - A real payment was put through the live test terminal's DirectNG hosted
 *    page. The result payload came back with `Response=000`, a `TranzilaTK`
 *    token AND `expmonth` / `expyear`. So the expiry DOES arrive with the
 *    capture (the doc page's "Data Retrieval" field list is incomplete, not
 *    authoritative) and the checkout does NOT have to collect it separately.
 *    parseHostedPaymentResult() reads both fields; they are still read
 *    defensively (null when absent) because one terminal's behaviour is not a
 *    contract, and a row with a token but NO expiry is handled downstream as a
 *    data gap, never as a decline.
 *  - That token was then charged through chargeToken() below: Tranzila
 *    answered `error_code: 0` with `processor_response_code: "000"`
 *    (transaction 15009). The request shape documented below is therefore the
 *    shape a real terminal accepted, not an inference from the docs.
 *
 * Tranzila still has NO test cards (support, 2026-09-23) - the test terminal
 * validates a REAL card - so every FURTHER exercise of this module also costs
 * real money. That is why the unit tests (tests/tranzila-charge-token.test.ts)
 * mock `fetch` and why PAYMENT_PROVIDER stays "polar".
 *
 * ── What is still unverified as of 2026-09-23 ──────────────────────────────
 *  1. Whether `cvv` is required for a token charge on our terminal. The doc
 *     says "Send the card expiry date, and CVV where required, alongside the
 *     token", and the endpoint's own field table marks cvv optional. We never
 *     store a CVV, so chargeToken() omits it; if a live decline turns out to
 *     be a missing-CVV rejection, the answer is a terminal setting on
 *     Tranzila's side, never storing CVVs here. (The 2026-09-23 live charge
 *     went through WITHOUT a cvv, so on that terminal it is not required.)
 *  2. `items[].price_type: "G"` / `items[].vat_percent: 18` appear in the doc
 *     page's cURL sample but not in its "Required Fields Only" sample and not
 *     in the body field table. chargeToken() sends the required shape only.
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
// at all - the terminal name is embedded in the URL path and nothing else is
// required to open the hosted page. TRANZILA_PASSWORD is kept as a required
// config gate anyway (isTranzilaConfigured() fails closed without it) purely
// as a defensive default until the still-undocumented recurring-charge-by-
// token path (see chargeToken() below) is confirmed with Tranzila support -
// at that point it will either turn out to need TranzilaPW (legacy
// convention) or nothing at all.
const TRANZILA_PASSWORD = process.env.TRANZILA_PASSWORD || "";

/**
 * Optional second terminal dedicated to token charges. Tranzila issued us
 * `friendinv` (the clearing terminal) and `friendinvtok` (the token
 * terminal); token charges are expected to run on the latter, but the field
 * is just a terminal name to the API, so if TRANZILA_TOKEN_TERMINAL is unset
 * chargeToken() falls back to TRANZILA_TERMINAL rather than failing. Card
 * CAPTURE (buildHostedPaymentUrl) deliberately keeps using TRANZILA_TERMINAL:
 * which terminal mints a token is a Tranzila-side configuration question we
 * have not exercised live, and quietly splitting capture across terminals
 * would be a worse failure than keeping it where it has always been.
 */
const TRANZILA_TOKEN_TERMINAL = process.env.TRANZILA_TOKEN_TERMINAL || "";

// JSON API v1 HMAC credentials - NEW as of the 2026-08-05 rebuild. The
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
 * isGrowConfigured()/isPolarConfigured() - every caller must gate on this
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
 * https://docs.tranzila.com/docs/payments-and-billing/authentication - all
 * four compute the SAME thing despite the prose description reading
 * ambiguously ("hash_hmac using 'sha256' on application key with secret +
 * request-time + nonce"): the HMAC **key** is `secret + requestTime + nonce`
 * concatenated, and the **message** being signed is the app key itself.
 * (e.g. PHP: `hash_hmac('sha256', $appKey, $secret . $time . $nonce)` - in
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
 * Blanks out reusable-credential values in a JSON string before it reaches a
 * log. Only two keys qualify today - `token` (the response echo of a saved
 * TranzilaTK) and `card_number` (which, on the request side, IS the token) -
 * and both are replaced wholesale rather than truncated, because a prefix of
 * an opaque handle is still a chunk of a credential. `last_4` and `card_mask`
 * are intentionally left alone: they are already safe to display.
 */
export function redactTranzilaSecrets(text: string): string {
  return text.replace(
    /("(?:token|card_number)"\s*:\s*")((?:\\.|[^"\\])*)(")/gi,
    (_m, open: string, _val: string, close: string) => `${open}[redacted]${close}`,
  );
}

/**
 * Low-level authenticated POST to a JSON API v1 endpoint (refundTransaction()
 * and, since 2026-09-23, chargeToken()). Unlike the old CGI-era assumption,
 * API v1 replies with real JSON, not form-encoded text.
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

  // Log the response so developers can inspect what Tranzila actually said.
  // NEVER log the HMAC headers or app secret, and - since 2026-09-23, when
  // chargeToken() started using this call - never log the saved-card token
  // either: the `create` response echoes a reusable `token` back, and a
  // reusable token in a log line is a stored credential in a log line.
  console.log(`[tranzila] API v1 ${path} -> ${res.status}`, redactTranzilaSecrets(raw));

  return { parsed, raw, status: res.status };
}

export interface CreateHostedPaymentOpts {
  /** Charge amount (NIS) - see `tokenOnly` below for what this means when a
   * trial/token-only checkout is in progress. */
  sum: number;
  /** Browser redirect after success (user-facing). Tranzila POSTs/redirects
   * the full transaction result here, including `TranzilaTK` - see the
   * "How the token comes back" note below. MUST NOT carry any secret: the
   * customer sees this URL, and so does anyone they paste it to. */
  successUrl: string;
  /** Browser redirect after failure/cancel (user-facing). Same rule. */
  failUrl: string;
  /**
   * Server-to-server copy of the same result payload (`notify_url_address`).
   * REQUIRED, not optional: this is the only leg of the flow that does not
   * pass through the customer's browser, so it is the only one allowed to
   * write anything, and it is where the per-checkout nonce rides. A checkout
   * built without it produces a capture whose result can never be
   * authenticated - which is exactly the state this module was in until
   * 2026-09-23.
   */
  notifyUrl: string;
  fullName: string;
  email: string;
  phone: string;
  /**
   * True for a first-time trial checkout where we only want a saved card
   * token, no real charge. Selects `tranmode=N` (SHVA J2 "checks card")
   * instead of `tranmode=A` (standard debit) - see TOKEN_VALIDATION_AMOUNT
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
 * redirects (customer's browser, GET or POST - POST is what we request via
 * `success_url_address`/`fail_url_address`) the FULL transaction result,
 * including `TranzilaTK`, `Response`, `sum`, `currency`, `index`, `ccno`,
 * `cardtype`, directly to the successUrl we pass here. There is a SEPARATE,
 * OPTIONAL `notify_url_address` field for a simultaneous server-to-server
 * copy of the same payload ("If a Notify page is configured, the transaction
 * data will also be sent to it simultaneously") - useful as a
 * tamper/reliability backstop, but not required to obtain the token.
 * DECIDED 2026-09-23: even though the browser's return trip carries the
 * token, the notify copy is the ONLY writer. The browser leg is a value that
 * travelled through the customer's own machine; the notify leg did not. So
 * `success_url_address` points at /api/tranzila/callback, which renders and
 * redirects the customer back to /billing and writes NOTHING, while
 * `notify_url_address` points at /api/tranzila/notify carrying a single-use
 * nonce, and that route does all the persistence.
 */
export function buildHostedPaymentUrl(opts: CreateHostedPaymentOpts): string {
  if (!isTranzilaConfigured()) {
    throw new TranzilaApiError(
      "Tranzila is not configured (TRANZILA_TERMINAL / TRANZILA_PASSWORD missing)",
    );
  }
  // Fail closed rather than silently building a capture nobody can
  // authenticate. See CreateHostedPaymentOpts.notifyUrl.
  if (!opts.notifyUrl) {
    throw new TranzilaApiError(
      "buildHostedPaymentUrl(): notifyUrl is required - a capture with no notify leg can never be verified",
    );
  }

  // CONFIRMED 2026-08-05 (iframe-integration-directng "tranmode" parameter
  // table): tranmode=A is a standard debit; tranmode=N is SHVA "J2 - Checks
  // Card" verification, which validates the card WITHOUT capturing funds
  // (contrast with tranmode=V, "J5", which explicitly "takes credit limit on
  // the amount specified" - i.e. only V holds funds; N does not). `sum` is
  // still required as a positive number in N-mode (the field's stated type
  // is "Positive Decimal Number" with no zero/empty carve-out, and the
  // `hidesum` parameter - which explicitly exists to hide `sum` from the
  // customer "only if ... tranmode=V or tranmode=K or tranmode=N" - implies
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
    // CONFIRMED (iframe-integration-directng, "Data Retrieval"): "If a Notify
    // page is configured, the transaction data will also be sent to it
    // simultaneously". Server-to-server, so the nonce on it never reaches the
    // customer's browser.
    notify_url_address: opts.notifyUrl,
    contact: opts.fullName,
    email: opts.email,
    phone: opts.phone,
  });

  return `${tranzilaIframeBase(TRANZILA_TERMINAL)}?${params.toString()}`;
}

/**
 * Shape a Tranzila token is allowed to have before we will put it on the
 * wire or into a database. Real tokens look like `O5d55d2922ca4021382` (the
 * doc page's own example) - an opaque alphanumeric handle. This is NOT a
 * checksum, it is a "did we get a token or a truncated error string" guard,
 * deliberately loose on length because the format is Tranzila's to change.
 */
const TRANZILA_TOKEN_RE = /^[A-Za-z0-9]{8,64}$/;

/**
 * Terminal that token charges run on. See TRANZILA_TOKEN_TERMINAL above for
 * why this falls back to the clearing terminal instead of throwing.
 */
function tokenChargeTerminal(): string {
  return TRANZILA_TOKEN_TERMINAL || TRANZILA_TERMINAL;
}

/**
 * Tranzila sends the card expiry back (where it sends it at all) in mixed
 * widths: the JSON API v1 response sample shows `"expiry_year": 22` while its
 * request sample shows `"expire_year": 2025`. Normalise to 4 digits so a
 * value round-tripped out of one and into the other cannot silently become
 * the year 22 AD.
 */
function normalizeExpireYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

export interface ChargeTokenOpts {
  /** The saved TranzilaTK token from a prior hosted-page capture. Goes in the
   * request's `card_number` field - see the module header. */
  token: string;
  /** Charge amount (NIS, shekels not agorot). */
  sum: number;
  /** Card expiry month, 1-12. The token does not carry it; Tranzila requires
   * it alongside the token. */
  expireMonth: number;
  /** Card expiry year. 2- or 4-digit both accepted; normalised to 4. */
  expireYear: number;
  /** Line-item name shown on the transaction in my.tranzila and in the
   * customer's statement detail. Defaults to a generic subscription label. */
  description?: string;
}

/** Outcome of a token charge. A DECLINE is a value here, never a throw - only
 * transport failure and misconfiguration throw (same convention as
 * refundTransaction()/tranzilaApiV1Call()). */
export interface ChargeTokenResult {
  /** True only when Tranzila accepted AND the processor approved. */
  success: boolean;
  /** API-level code: 0 means the request itself was well-formed and accepted. */
  errorCode: number | null;
  /** API-level message ("success", or the rejection reason). */
  message: string;
  /** SHVA/processor code from `transaction_result.processor_response_code`;
   * "000" is an approval, anything else is a decline. See
   * https://docs.tranzila.com/docs/payments-and-billing/transaction-response-codes */
  processorResponseCode: string | null;
  /** Tranzila's transaction id, needed later by refundTransaction(). */
  transactionId: string | null;
  /** Approval number, also needed by refundTransaction(). */
  authorizationNumber: string | null;
  /** Last 4 digits of the charged card, safe to store and display. */
  last4: string | null;
  /** Amount Tranzila says it actually charged (NIS). */
  amount: number | null;
  raw: TranzilaRawResponse;
}

/**
 * Charges a previously saved TranzilaTK token server-to-server, with no
 * customer present - the call our own subscription-billing cron needs.
 *
 * CONFIRMED 2026-09-23 (Tranzila support in writing, plus the rewritten
 * "Recommended Integration Workflow" section of
 * https://docs.tranzila.com/docs/payments-and-billing/tranzila-transactions-api-1/create-a-credit-card-transaction):
 * the token is submitted in the `card_number` field of the ordinary
 * `POST /v1/transaction/credit_card/create` endpoint. No paid module. The
 * 4 X-tranzila-api-* HMAC headers that tranzilaApiV1Headers() already builds
 * are the entire authentication story; TranzilaPW plays no part here.
 *
 * Exact body sent (field names verified against the endpoint's own body
 * table and its "Required Fields Only" example):
 *
 *   {
 *     "terminal_name": "<TRANZILA_TOKEN_TERMINAL || TRANZILA_TERMINAL>",
 *     "txn_type": "debit",
 *     "txn_currency_code": "ILS",
 *     "card_number": "<TranzilaTK token>",
 *     "expire_month": <1-12>,
 *     "expire_year": <4-digit>,
 *     "payment_plan": 1,
 *     "response_language": "english",
 *     "items": [{ "name": "<description>", "type": "I",
 *                 "unit_price": <sum>, "units_number": 1 }]
 *   }
 *
 * Deliberately NOT sent: `cvv` (never stored - see unverified item 3 in the
 * module header), `client` (the doc states it is not attached to the
 * transaction record, so it is misleading to fill in), `card_holder_id`,
 * `price_type`/`vat_percent` (not in the required shape).
 *
 * NOTE on txn_currency_code: the endpoint's body table gives it as a string
 * with example "ILS" - an ISO alpha code, NOT the numeric "1" that DirectNG's
 * hosted-page `currency` field uses. Two different conventions in one
 * integration; TRANZILA_CURRENCY_ILS stays "1" and is used only for the
 * hosted page.
 *
 * Success requires BOTH error_code === 0 (Tranzila accepted the request) and
 * processor_response_code === "000" (the card issuer approved). A response
 * missing the processor code is treated as NOT successful: this decides
 * whether a subscriber's card was actually charged, so it fails closed.
 */
export async function chargeToken(opts: ChargeTokenOpts): Promise<ChargeTokenResult> {
  const terminal = tokenChargeTerminal();
  if (!terminal) {
    throw new TranzilaApiError(
      "Tranzila token charging is not configured (TRANZILA_TOKEN_TERMINAL / TRANZILA_TERMINAL missing)",
    );
  }
  if (!TRANZILA_TOKEN_RE.test(opts.token)) {
    // Never echo the token itself into an error message or a log line.
    throw new TranzilaApiError(
      "chargeToken(): token is missing or not in Tranzila's token format",
    );
  }
  if (!Number.isFinite(opts.sum) || opts.sum <= 0) {
    throw new TranzilaApiError(`chargeToken(): sum must be a positive number, got ${opts.sum}`);
  }
  if (!Number.isInteger(opts.expireMonth) || opts.expireMonth < 1 || opts.expireMonth > 12) {
    throw new TranzilaApiError(
      `chargeToken(): expireMonth must be an integer 1-12, got ${opts.expireMonth}`,
    );
  }
  const expireYear = normalizeExpireYear(Number(opts.expireYear));
  if (!Number.isInteger(expireYear) || expireYear < 2000 || expireYear > 2100) {
    throw new TranzilaApiError(
      `chargeToken(): expireYear must be a plausible year, got ${opts.expireYear}`,
    );
  }

  const raw = await tranzilaApiV1Call("/transaction/credit_card/create", {
    terminal_name: terminal,
    txn_type: "debit",
    txn_currency_code: "ILS",
    card_number: opts.token,
    expire_month: opts.expireMonth,
    expire_year: expireYear,
    // "1 - Default. A single regular payment." Sent explicitly rather than
    // relying on the documented default, so an upstream default change
    // cannot silently turn a renewal into installments.
    payment_plan: 1,
    response_language: "english",
    items: [
      {
        name: opts.description || "Subscription",
        // "type": "I" is what every example on the endpoint page uses for a
        // line item; the value is not explained in prose anywhere.
        type: "I",
        unit_price: opts.sum,
        units_number: 1,
      },
    ],
  });

  const result = (raw.parsed.transaction_result ?? {}) as Record<string, unknown>;
  const errorCodeRaw = raw.parsed.error_code;
  const errorCode =
    typeof errorCodeRaw === "number"
      ? errorCodeRaw
      : typeof errorCodeRaw === "string" && errorCodeRaw.trim() !== ""
        ? Number(errorCodeRaw)
        : null;
  const processorResponseCode =
    result.processor_response_code == null ? null : String(result.processor_response_code);

  return {
    success: errorCode === 0 && processorResponseCode === "000",
    errorCode: Number.isNaN(errorCode as number) ? null : errorCode,
    message: typeof raw.parsed.message === "string" ? raw.parsed.message : "",
    processorResponseCode,
    transactionId: result.transaction_id == null ? null : String(result.transaction_id),
    authorizationNumber: result.auth_number == null ? null : String(result.auth_number),
    last4: result.last_4 == null ? null : String(result.last_4),
    amount: typeof result.amount === "number" ? result.amount : Number(result.amount) || null,
    raw,
  };
}

// ── DirectNG hosted-page result payload ────────────────────────────────────

/** Parsed DirectNG result. `token` is null when no usable TranzilaTK arrived,
 * which is the single fact both callback routes exist to report. */
export interface HostedPaymentResult {
  /** True iff `Response` is exactly "000" (the documented success code). */
  approved: boolean;
  /** Raw `Response` code, kept even when it is not "000" so a decline can be
   * looked up against Tranzila's response-code table. */
  responseCode: string | null;
  /** The saved-card token, or null if absent/malformed. NEVER log this. */
  token: string | null;
  /** True when a TranzilaTK key was present but failed TRANZILA_TOKEN_RE -
   * distinct from "no tokenization on this terminal", and worth an alert. */
  tokenMalformed: boolean;
  /** Charged amount (NIS) as Tranzila reports it. */
  sum: number | null;
  /** DirectNG numeric currency code ("1" = ILS). Not the API's "ILS". */
  currency: string | null;
  /** Transaction index number. */
  index: string | null;
  /** Unique transaction id in Tranzila's system. */
  transactionId: string | null;
  /** Last 4 digits of the card, derived from `ccno`. Safe to store/log. */
  last4: string | null;
  /** Card brand code (1 Mastercard, 2 Visa, 3 Diners, 4 Amex, 5 Isracard,
   * 6 Maestro). */
  cardType: string | null;
  /** Expiry month. Not in the doc page's response field list, but CONFIRMED
   * present on a real 2026-09-23 capture (`expmonth`). Still nullable: a token
   * without an expiry is unchargeable, and downstream must treat that as a
   * data gap rather than guess. */
  expireMonth: number | null;
  /** Expiry year (normalised to 4 digits), same story as expireMonth. */
  expireYear: number | null;
  /** Terminal name Tranzila echoes back as `supplier`. */
  terminal: string | null;
  /** `tranmode` echoed back (A standard, V J5, K token-only, N J2, J sto). */
  tranmode: string | null;
  /** Every field as received, lowercased keys, for diagnostics. Contains the
   * token - treat as secret, never log wholesale. */
  raw: Record<string, string>;
}

/** Anything a route can realistically hand the parser. */
export type HostedPaymentPayload =
  | URLSearchParams
  | FormData
  | Record<string, unknown>
  | Iterable<[string, unknown]>;

function toLowerKeyed(payload: HostedPaymentPayload): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: unknown, value: unknown) => {
    if (typeof key !== "string") return;
    // File parts (FormData) and objects have no business in this payload.
    if (typeof value !== "string" && typeof value !== "number") return;
    const k = key.trim().toLowerCase();
    if (!k || k.length > 100) return;
    const v = String(value);
    // Cap any single field: a legitimate DirectNG field is tens of chars.
    if (v.length > 2000) return;
    // First occurrence wins, so a duplicated key cannot overwrite the real one.
    if (!(k in out)) out[k] = v;
  };

  if (payload instanceof URLSearchParams || payload instanceof FormData) {
    for (const [k, v] of payload.entries()) put(k, v);
  } else if (payload && typeof (payload as Iterable<[string, unknown]>)[Symbol.iterator] === "function") {
    for (const [k, v] of payload as Iterable<[string, unknown]>) put(k, v);
  } else if (payload && typeof payload === "object") {
    for (const [k, v] of Object.entries(payload)) put(k, Array.isArray(v) ? v[0] : v);
  }
  return out;
}

function numOrNull(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses the transaction payload DirectNG sends back after a hosted-page
 * capture - to `success_url_address`/`fail_url_address` (browser, POST or
 * GET) and, when configured, simultaneously to `notify_url_address`
 * (server-to-server). CONFIRMED 2026-09-23 with Tranzila support that the
 * notify copy carries the FULL payload including TranzilaTK, not a reduced
 * one, which is what makes a server-side route able to save the token without
 * trusting the browser's return trip.
 *
 * Field names per the "Key Response Fields" table on
 * https://docs.tranzila.com/docs/payments-and-billing/iframe-integration-directng
 * (Response, transaction_id, index, sum, currency, ccno, cardtype,
 * cardissuer, cardacquirer, TranzilaTK, txn_type, tranmode, club_number,
 * supplier). Lookup is case-insensitive on purpose: the wire mixes casings
 * (`TranzilaTK`, `Response`, `sum`) and a casing change upstream must not
 * silently drop a token.
 *
 * Both `tranmode=K` ("create token without checking card") and the
 * verification modes return a token when tokenization is enabled on the
 * terminal, so this parser does not gate on tranmode.
 *
 * Purely structural: it never throws, never hits the network, and makes no
 * claim that the payload is authentic. Authenticity comes from the caller:
 * /api/tranzila/notify consumes a single-use intent nonce that only ever
 * travelled on notify_url_address (see src/lib/tranzila-activation.ts). A
 * server-side re-check by transaction index would be strictly better, but
 * Tranzila documents no transaction-query endpoint, so it does not exist to
 * call today.
 */
export function parseHostedPaymentResult(payload: HostedPaymentPayload): HostedPaymentResult {
  const raw = toLowerKeyed(payload);

  const responseCode = raw.response ?? null;
  const tokenRaw = raw.tranzilatk ?? "";
  const tokenOk = TRANZILA_TOKEN_RE.test(tokenRaw);

  // `ccno` is documented as the last 4 digits, but terminals have been seen
  // returning a masked PAN. Take the trailing 4 digits either way, and never
  // keep anything longer.
  const digits = (raw.ccno ?? "").replace(/\D/g, "");
  const last4 = digits.length >= 4 ? digits.slice(-4) : digits || null;

  const expMonth = numOrNull(raw.expmonth);
  const expYear = numOrNull(raw.expyear);

  return {
    approved: responseCode === "000",
    responseCode,
    token: tokenOk ? tokenRaw : null,
    tokenMalformed: tokenRaw.length > 0 && !tokenOk,
    sum: numOrNull(raw.sum),
    currency: raw.currency ?? null,
    index: raw.index ?? null,
    transactionId: raw.transaction_id ?? null,
    last4,
    cardType: raw.cardtype ?? null,
    expireMonth: expMonth != null && expMonth >= 1 && expMonth <= 12 ? expMonth : null,
    expireYear: expYear != null ? normalizeExpireYear(expYear) : null,
    terminal: raw.supplier ?? null,
    tranmode: raw.tranmode ?? null,
    raw,
  };
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
 * "reference_txn_id": 12345, "authorization_number": "0000000"}` - no card
 * data required for `cancel`, unlike `credit` which re-requires a full card
 * number).
 *
 * Success detection: `error_code === 0` at the top level (API v1's own
 * convention - NOT the legacy `Response === "000"` used by the DirectNG
 * hosted-page redirect). The nested `transaction_result.processor_response_code`
 * mirrors the same SHVA codes as the redirect flow's `Response` field for
 * additional detail.
 *
 * TODO(verify against a live sandbox terminal): whether `cancel` works for a
 * transaction from a prior day, or is restricted to same-day voids (SHVA
 * same-day-void windows are the norm across Israeli processors - Tranzila's
 * own docs don't state a time limit for `cancel`). If `cancel` is same-day
 * only, a genuine multi-day refund would need `txn_type: credit`, which per
 * the spec's own code example requires re-submitting full card data
 * (card_number/expire_month/expire_year/cvv) - something we deliberately do
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
 * hosted-page checkout. NOT actually captured from the card in that case -
 * see the `tranmode` comment in buildHostedPaymentUrl() for why: DirectNG's
 * `tranmode=N` (SHVA "J2 - Checks Card") verifies the card without taking
 * funds, but the `sum` field itself is documented as a required "Positive
 * Decimal Number" with no zero-value carve-out, so a positive placeholder
 * must still be sent. TODO(verify on first live sandbox test): confirm that
 * tranmode=N genuinely results in a ₪0 statement impact (the docs describe
 * it as "checks card" in contrast to tranmode=V which explicitly "takes
 * credit limit" - strongly implying no capture - but this has not been
 * exercised against a real terminal).
 */
export const TOKEN_VALIDATION_AMOUNT = 1;

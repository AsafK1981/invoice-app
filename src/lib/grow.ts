import { PLANS, type PlanTier, type BillingInterval } from "./plans";

/**
 * Grow (by Meshulam) payment client, Israeli direct card processor.
 *
 * ── Auth model ──────────────────────────────────────────────────────────
 * Unlike Polar (bearer-token SDK), Grow has NO SDK and NO bearer token.
 * Every call is a plain **form-encoded POST** whose body carries two
 * identifying fields, `userId` and `pageCode`, issued per merchant.
 * There's no `apiKey` for a single-business merchant (that only exists for
 * multi-business platform integrations). All calls MUST be server-to-server
 * (never from the browser, since userId/pageCode are effectively secrets),
 * and Grow rejects any parameter value containing special characters.
 *
 * ── Callbacks are NOT signed ─────────────────────────────────────────────
 * IMPORTANT: Grow does NOT provide an HMAC / signature scheme on its
 * server-to-server callback. That means the callback route CANNOT trust the
 * payload just because it arrived. It must do its own verification dance:
 *   1. Match the returned `customFields` to a real pending checkout in OUR db.
 *   2. Cross-check the echoed `sum`/`status` against what we expected.
 *   3. Optionally call `approveTransaction` as a confirmation step; but note
 *      Grow's docs warn the transaction is processed even if approveTransaction
 *      is never called or fails, so it CONFIRMS authenticity, it does not gate.
 * As defense-in-depth we also invent our own shared secret (GROW_CALLBACK_SECRET)
 * and embed it in the callback URL as a query param; see the checkout route.
 *
 * Docs: https://grow-il.readme.io/
 */

const GROW_SANDBOX_BASE = "https://sandbox.meshulam.co.il/api/light/server/1.0/";
// NOTE: production host is less certain than sandbox; keep it overridable via
// env (GROW_PRODUCTION_BASE) so we don't have to redeploy code if Grow's real
// production base URL differs from this best guess.
// TODO(verify against Grow's live docs): confirm the production base URL.
const GROW_PRODUCTION_BASE =
  process.env.GROW_PRODUCTION_BASE ||
  "https://api.meshulam.co.il/api/light/server/1.0/";

const GROW_USER_ID = process.env.GROW_USER_ID || "";
const GROW_PAGE_CODE = process.env.GROW_PAGE_CODE || "";
const GROW_MODE: "sandbox" | "production" =
  process.env.GROW_MODE === "production" ? "production" : "sandbox";

/**
 * Our own app-generated shared secret (NOT a Grow-native feature). We embed it
 * in the callback URL as `?cs=<secret>` so random internet traffic can't POST
 * junk to our callback endpoint and forge subscription activations. Since Grow
 * doesn't sign its callbacks, this is our first cheap line of defense; the real
 * verification (customFields → known pending checkout + sum cross-check) happens
 * in the callback route.
 */
export const GROW_CALLBACK_SECRET = process.env.GROW_CALLBACK_SECRET || "";

/**
 * True iff the minimum Grow credentials are present. Mirrors isPolarConfigured().
 *
 * GROW_CALLBACK_SECRET is REQUIRED here, not optional. Without it the checkout
 * route would omit `?cs=` from the callback URL while the callback route still
 * rejects every unsigned call, so the customer would be charged and the
 * subscription would never activate. Failing the whole flow closed at checkout
 * (503, before any money moves) is the only safe direction: the alternative,
 * letting unsigned callbacks through when the secret happens to be unset, would
 * turn a missing env var into an open endpoint that anyone could POST to in
 * order to activate a paid plan for an arbitrary user. Grow does not sign its
 * callbacks, so this secret is the ONLY primary trust gate.
 */
export function isGrowConfigured(): boolean {
  return !!GROW_USER_ID && !!GROW_PAGE_CODE && !!GROW_CALLBACK_SECRET;
}

/** Returns the sandbox or production base URL per GROW_MODE. */
export function growBaseUrl(): string {
  return GROW_MODE === "production" ? GROW_PRODUCTION_BASE : GROW_SANDBOX_BASE;
}

/** Thrown on network/transport failure talking to Grow (not on a business error
 * inside a 200 response; those are returned in the parsed body for the caller
 * to inspect). */
export class GrowApiError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GrowApiError";
  }
}

/** Shape returned by every low-level call: the parsed body (best-effort) plus
 * the raw text so callers can inspect during development while response keys
 * are still being confirmed against Grow's live docs. */
export interface GrowRawResponse {
  /** Parsed body: object if JSON or form-encoded, else the raw string. */
  parsed: Record<string, unknown> | string;
  /** Untouched response text. */
  raw: string;
  /** HTTP status code. */
  status: number;
}

/**
 * Low-level form-encoded POST to a Grow endpoint. Auto-injects userId/pageCode.
 *
 * Grow's response content-type wasn't confirmed as JSON vs form-encoded from a
 * directly fetched reference page, so we parse defensively: try JSON.parse
 * first, fall back to URLSearchParams, and always return the raw text.
 */
export async function growApiCall(
  endpoint: string,
  params: Record<string, string>,
): Promise<GrowRawResponse> {
  if (!isGrowConfigured()) {
    throw new GrowApiError(
      "Grow is not configured (GROW_USER_ID / GROW_PAGE_CODE / GROW_CALLBACK_SECRET missing)",
    );
  }

  const body = new URLSearchParams({
    userId: GROW_USER_ID,
    pageCode: GROW_PAGE_CODE,
    ...params,
  });

  const url = growBaseUrl() + endpoint;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new GrowApiError(`Network error calling Grow ${endpoint}`, err);
  }

  const raw = await res.text();

  // Parse defensively: JSON first, then form-encoded, else keep the string.
  let parsed: Record<string, unknown> | string = raw;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    try {
      const sp = new URLSearchParams(raw);
      const obj: Record<string, string> = {};
      for (const [k, v] of sp.entries()) obj[k] = v;
      // Only treat it as form-encoded if we actually got fields out.
      if (Object.keys(obj).length > 0) parsed = obj;
    } catch {
      parsed = raw;
    }
  }

  // Log the raw response so developers can inspect real Grow responses while
  // response-key assumptions are still being confirmed against the live docs.
  console.log(`[grow] ${endpoint} -> ${res.status}`, raw);

  return { parsed, raw, status: res.status };
}

/**
 * Digs through a (possibly nested) parsed Grow response for the first present
 * value among `keys`. Grow sometimes wraps payloads under `data`, so we check
 * both the top level and `data.*`.
 */
function extractValue(
  parsed: Record<string, unknown> | string,
  keys: string[],
): string | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const data =
    typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : undefined;
  for (const key of keys) {
    const top = parsed[key];
    if (typeof top === "string" && top) return top;
    if (typeof top === "number") return String(top);
    if (data) {
      const nested = data[key];
      if (typeof nested === "string" && nested) return nested;
      if (typeof nested === "number") return String(nested);
    }
  }
  return undefined;
}

export interface CreatePaymentProcessOpts {
  /** Charge amount (NIS). */
  sum: number;
  description: string;
  /** Browser redirect after success (user-facing). */
  successUrl: string;
  /** Browser redirect after cancel (user-facing). */
  cancelUrl: string;
  fullName: string;
  phone: string;
  email: string;
  /** Passthrough data echoed back on the callback so we can map to our user. */
  customFields: Record<string, string>;
  /** If true, also return a reusable token for future recurring charges. */
  saveToken: boolean;
  /**
   * Server-to-server notification URL Grow POSTs the callback to. Distinct from
   * successUrl/cancelUrl (those are browser redirects). We attach our own
   * ?cs=<secret> anti-spoof param to this URL in the caller.
   */
  callbackUrl?: string;
}

/**
 * Creates a Grow hosted payment page via `createPaymentProcess`.
 *
 * TODO(verify against Grow's live docs): several field names below could not be
 * confirmed from a directly fetched reference page:
 *   - Custom passthrough field param name. We use `cField1`, `cField2`, ...
 *     (Meshulam-family convention), VERIFY the exact param name against Grow's
 *     live reference before shipping.
 *   - Server-callback URL field name. We send it as `notifyUrl` (best guess);
 *     Grow may call it `callBackUrl` / `serverCallbackUrl` / or the successUrl
 *     itself may be what receives the server callback. VERIFY before shipping.
 *   - Response key holding the redirect URL. We look for data.url / url /
 *     processUrl / link and throw with guidance if none match.
 */
export async function createPaymentProcess(
  opts: CreatePaymentProcessOpts,
): Promise<{ raw: GrowRawResponse; url: string }> {
  const params: Record<string, string> = {
    sum: String(opts.sum),
    description: opts.description,
    chargeType: "1", // 1 = regular charge
    successUrl: opts.successUrl,
    cancelUrl: opts.cancelUrl,
    "pageField[fullName]": opts.fullName,
    "pageField[phone]": opts.phone,
    "pageField[email]": opts.email,
  };

  if (opts.saveToken) params.saveCardToken = "1";

  // TODO(verify against Grow's live docs): custom-field param name unconfirmed.
  // Using cField1..cFieldN (Meshulam-family convention). Map keys→values in a
  // stable order so the callback can be decoded predictably.
  let i = 1;
  for (const [k, v] of Object.entries(opts.customFields)) {
    params[`cField${i}`] = `${k}=${v}`;
    i += 1;
  }

  // TODO(verify against Grow's live docs): server-callback URL field name.
  if (opts.callbackUrl) params.notifyUrl = opts.callbackUrl;

  const raw = await growApiCall("createPaymentProcess", params);

  // TODO(verify against Grow's live docs): confirm the real redirect-URL key.
  // Defensively probe common candidates; log+throw with guidance if none hit.
  const url = extractValue(raw.parsed, ["url", "processUrl", "link", "paymentUrl"]);
  if (!url) {
    throw new GrowApiError(
      `createPaymentProcess returned no redirect URL. Inspect the raw response ` +
        `and fix the response key in grow.ts. Raw: ${raw.raw}`,
    );
  }

  return { raw, url };
}

export interface ChargeTokenOpts {
  /** The saved card token from a prior saveCardToken=1 payment. */
  token: string;
  /** Charge amount (NIS). */
  sum: number;
  description: string;
}

/**
 * Charges a previously saved token via `createTransactionWithToken`, fully
 * server-to-server (no customer interaction). Company-managed recurring: we do
 * NOT send `paymentType=1` (which would make Grow own the schedule); omitting
 * it means OUR cron triggers each charge, so we control timing.
 *
 * IMPORTANT: do NOT call approveTransaction after this; that step is only for
 * interactive hosted-page charges (explicit, confirmed Grow rule).
 *
 * TODO(verify against Grow's live docs): confirm the token param name. We send
 * it as `token`; Grow may expect `transactionToken` / `cardToken`.
 */
export async function chargeToken(
  opts: ChargeTokenOpts,
): Promise<{ raw: GrowRawResponse; success: boolean; transactionId?: string }> {
  const params: Record<string, string> = {
    token: opts.token,
    sum: String(opts.sum),
    description: opts.description,
    // Intentionally NO paymentType=1: company-managed recurring (our cron).
  };

  const raw = await growApiCall("createTransactionWithToken", params);

  // Best-effort success detection. Grow's exact success schema is unconfirmed,
  // so be defensive: statusCode "1" or a present transactionId with no error
  // field counts as success. Ambiguous responses are logged (growApiCall logs
  // raw already) and treated as failure so the cron retries rather than
  // falsely marking a charge as paid.
  const transactionId = extractValue(raw.parsed, ["transactionId", "transactionID"]);
  const statusCode = extractValue(raw.parsed, ["statusCode", "status"]);
  const hasError =
    typeof raw.parsed === "object" &&
    raw.parsed !== null &&
    ("error" in raw.parsed || "err" in raw.parsed);

  const success = statusCode === "1" || (!!transactionId && !hasError);

  return { raw, success, transactionId };
}

/**
 * Price for a (tier, interval) in NIS, sourced from PLANS (never duplicated
 * here). Yearly uses priceYearly, monthly uses priceMonthly.
 */
export function getPlanPrice(tier: PlanTier, interval: BillingInterval): number {
  const plan = PLANS[tier];
  return interval === "year" ? plan.priceYearly : plan.priceMonthly;
}

/**
 * The nominal charge (NIS) used to tokenize a card at the START of a trial,
 * the SINGLE SOURCE OF TRUTH for this amount. The checkout route charges it
 * for a first-time trial; the callback route accepts it as a valid `sum` in
 * addition to the real plan price. Both import it from here, so they can never
 * drift apart (a drift would make the callback reject a legitimate trial charge,
 * so the customer pays and the subscription never activates).
 *
 * Why ₪1 and not ₪0: card networks generally reject a ₪0 authorization, so many
 * processors require a nominal ≥₪1 validation charge even just to save a
 * reusable token. No real payment is intended here; the first real charge fires
 * later via the recurring-billing cron.
 *
 * TODO(verify against Grow's live docs / support): true ₪0 tokenization. IF Grow
 * supports a genuine 0-charge tokenization mode, switch to that instead (it
 * directly affects trial UX; the user shouldn't be charged during a "free"
 * trial). This is the single most important billing detail to confirm before
 * shipping.
 */
export const TOKEN_VALIDATION_AMOUNT = 1;

/**
 * Best-effort acknowledgment of an interactive hosted-page charge via Grow's
 * `approveTransaction` endpoint. This is the ONE place approveTransaction is
 * legitimately used (interactive callback), unlike chargeToken() which must
 * NOT call it.
 *
 * IMPORTANT: this is NOT a security gate. Grow's docs explicitly state the
 * transaction is processed even if approveTransaction is never called or fails.
 * So the callback route must NOT block on this; it calls it best-effort for
 * whatever legitimate acknowledgment value it has, logs failures, and moves on.
 * The real trust anchors live in the callback route (our GROW_CALLBACK_SECRET
 * query param + customFields→pending-checkout + sum cross-check).
 *
 * TODO(verify against Grow's live docs / confirm during sandbox testing): the
 * exact param names approveTransaction expects. We forward the identifying
 * fields Grow sent us (processId/processToken/transactionId/transactionToken/
 * sum/asmachta). pageCode + userId are auto-injected by growApiCall. Confirm the
 * real required set against a live sandbox callback before shipping.
 */
export async function approveTransaction(
  params: Record<string, string>,
): Promise<GrowRawResponse> {
  return growApiCall("approveTransaction", params);
}

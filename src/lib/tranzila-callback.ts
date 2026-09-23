import { parseHostedPaymentResult, type HostedPaymentResult } from "./tranzila";
import { checkRate, clientIp } from "./rate-limit";

/**
 * The BROWSER leg of a Tranzila DirectNG hosted-page capture, plus the payload
 * reading/summarising both legs share.
 *
 *   - /api/tranzila/callback (this file) - where Tranzila sends the CUSTOMER
 *     back (`success_url_address` / `fail_url_address`). It renders and
 *     redirects. It writes NOTHING, by design.
 *   - /api/tranzila/notify (src/lib/tranzila-notify.ts) - the simultaneous
 *     server-to-server copy (`notify_url_address`). That one is the sole
 *     writer, and it carries the single-use intent nonce that authenticates
 *     the result.
 *
 * ── Why the browser leg writes nothing (2026-09-23 decision) ───────────────
 * CONFIRMED with Tranzila support that the notify copy carries the FULL
 * payload including `TranzilaTK`, so nothing is lost by ignoring the browser's
 * copy - and a value that travelled through the customer's own machine is a
 * value the customer can change. The nonce is deliberately NOT on this URL
 * either: putting the authenticator on a URL the customer can read would hand
 * them the key to their own payment result.
 *
 * So this route's whole job is: read the payload, log a redacted summary, send
 * the customer back to /billing. If both legs wrote, they would also race each
 * other over the same subscription row; one writer removes the question.
 *
 * ── Logging rules (non-negotiable) ────────────────────────────────────────
 * The token and the card number never reach a log. Only the last 4 digits,
 * the response code, the amount, and whether a token was present.
 */

/** Hard cap on the request body. A real DirectNG payload is well under 2 KB. */
const MAX_BODY_BYTES = 16 * 1024;

/** Public, unauthenticated endpoints: keep a cheap per-IP ceiling so they
 * cannot be used as a free log-spam or CPU sink. Tranzila itself sends at most
 * a couple of hits per checkout. */
export const RATE_MAX = 60;
export const RATE_WINDOW_MS = 60_000;

export type TranzilaCallbackChannel = "callback" | "notify";

/** Everything the routes report, and the only thing that is ever logged. */
export interface TranzilaCallbackSummary {
  channel: TranzilaCallbackChannel;
  /** GET (query string) or POST (body). */
  method: string;
  /** Did a usable TranzilaTK arrive? */
  tokenReceived: boolean;
  /** A TranzilaTK key was present but did not look like a token. */
  tokenMalformed: boolean;
  /** Tranzila's `Response` code; "000" is success. */
  responseCode: string | null;
  approved: boolean;
  sum: number | null;
  currency: string | null;
  index: string | null;
  transactionId: string | null;
  /** Safe to log and display. */
  last4: string | null;
  cardType: string | null;
  tranmode: string | null;
  terminal: string | null;
  /** Whether the payload carried a card expiry. Confirmed present on a real
   * 2026-09-23 capture, still reported because a token with no expiry cannot
   * be charged and has to be visible as a data gap. */
  expiryPresent: boolean;
  /** Field names received, so a live test shows what the terminal really
   * sends without exposing any value. Keys only, never values. */
  fields: string[];
}

export function summarizeTranzilaResult(
  channel: TranzilaCallbackChannel,
  method: string,
  parsed: HostedPaymentResult,
): TranzilaCallbackSummary {
  return {
    channel,
    method,
    tokenReceived: parsed.token !== null,
    tokenMalformed: parsed.tokenMalformed,
    responseCode: parsed.responseCode,
    approved: parsed.approved,
    sum: parsed.sum,
    currency: parsed.currency,
    index: parsed.index,
    transactionId: parsed.transactionId,
    last4: parsed.last4,
    cardType: parsed.cardType,
    tranmode: parsed.tranmode,
    terminal: parsed.terminal,
    expiryPresent: parsed.expireMonth !== null && parsed.expireYear !== null,
    fields: Object.keys(parsed.raw).sort(),
  };
}

/**
 * Pulls the key/value payload out of the request without ever assuming a
 * content type. DirectNG is configured per-terminal to send POST or GET, and
 * the POST has been reported as both urlencoded and multipart, so all three
 * are handled and anything else falls back to the query string.
 */
export async function readTranzilaPayload(req: Request): Promise<{
  params: URLSearchParams | FormData;
  oversize: boolean;
}> {
  const url = new URL(req.url);

  if (req.method !== "POST") {
    return { params: url.searchParams, oversize: false };
  }

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { params: url.searchParams, oversize: true };
  }

  const contentType = (req.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    try {
      return { params: await req.formData(), oversize: false };
    } catch {
      return { params: url.searchParams, oversize: false };
    }
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return { params: url.searchParams, oversize: false };
  }
  if (body.length > MAX_BODY_BYTES) {
    return { params: url.searchParams, oversize: true };
  }

  // A JSON body is not what DirectNG sends, but accepting it costs one branch
  // and avoids a mystery "no token" if a terminal is ever configured that way.
  if (contentType.includes("application/json")) {
    try {
      const obj = JSON.parse(body) as Record<string, unknown>;
      const sp = new URLSearchParams();
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === "string" || typeof v === "number") sp.set(k, String(v));
        }
      }
      return { params: sp, oversize: false };
    } catch {
      return { params: url.searchParams, oversize: false };
    }
  }

  const fromBody = new URLSearchParams(body);
  // Empty POST body (or one we could not parse) - fall back to the query
  // string, since DirectNG can be configured to put the payload there too.
  if ([...fromBody.keys()].length === 0) {
    return { params: url.searchParams, oversize: false };
  }
  return { params: fromBody, oversize: false };
}

/** Shared 413 for a body over the cap. */
export function payloadTooLarge(channel: TranzilaCallbackChannel): Response {
  console.warn(`[tranzila] ${channel}: payload over ${MAX_BODY_BYTES} bytes, rejected`);
  return new Response(JSON.stringify({ ok: false, error: "Payload too large" }), {
    status: 413,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Shared 429 for the per-IP ceiling. */
export function rateLimited(req: Request, channel: TranzilaCallbackChannel): Response | null {
  const rl = checkRate({
    key: `tranzila-${channel}:${clientIp(req)}`,
    max: RATE_MAX,
    windowMs: RATE_WINDOW_MS,
  });
  if (rl.ok) return null;
  return new Response(JSON.stringify({ ok: false, error: "Too many requests" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(Math.ceil(rl.resetIn / 1000)),
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlBody(summary: TranzilaCallbackSummary): string {
  const headline = summary.tokenReceived
    ? "Token received"
    : summary.tokenMalformed
      ? "A TranzilaTK field arrived but was not in token format"
      : "No token in this payload";
  const rows: [string, string][] = [
    ["token received", summary.tokenReceived ? "yes" : "no"],
    ["Response", summary.responseCode ?? "(absent)"],
    ["approved", summary.approved ? "yes" : "no"],
    ["sum", summary.sum == null ? "(absent)" : String(summary.sum)],
    ["card (last 4)", summary.last4 ?? "(absent)"],
    ["tranmode", summary.tranmode ?? "(absent)"],
    ["expiry present", summary.expiryPresent ? "yes" : "no"],
    ["fields", summary.fields.join(", ") || "(none)"],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Tranzila ${escapeHtml(summary.channel)}</title>
<meta name="robots" content="noindex"></head>
<body style="font:14px/1.6 system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem">
<h1 style="font-size:1.1rem">Tranzila ${escapeHtml(summary.channel)}: ${escapeHtml(headline)}</h1>
<p style="color:#666">Diagnostic view. Nothing was saved here; persistence is /api/tranzila/notify's job.</p>
<table style="border-collapse:collapse">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(k)}</td><td style="padding:2px 0"><code>${escapeHtml(v)}</code></td></tr>`,
    )
    .join("")}</table>
</body></html>`;
}

/**
 * The browser's return trip. Reads the payload, logs a redacted summary, and
 * sends the customer to /billing - success or canceled decided by Tranzila's
 * own `Response` code, with an explicit `?status=failed` (which the checkout
 * route puts on fail_url_address) as a second signal.
 *
 * Writes nothing. Ever. See the module header.
 *
 * `?diag=1` renders the old diagnostic table instead of redirecting; it is how
 * a live terminal test shows which fields really arrive. It exposes no secret
 * (last 4 digits and field NAMES only), which is why it needs no gate.
 *
 * The redirect Location is RELATIVE on purpose: this route can legitimately be
 * reached on either the canonical domain or the older vercel.app host, and a
 * relative redirect keeps the customer on whichever one they started from
 * rather than bouncing them across domains mid-flow.
 */
export async function handleTranzilaCallback(req: Request): Promise<Response> {
  const limited = rateLimited(req, "callback");
  if (limited) return limited;

  const { params, oversize } = await readTranzilaPayload(req);
  if (oversize) return payloadTooLarge("callback");

  const url = new URL(req.url);
  const parsed = parseHostedPaymentResult(params);
  const summary = summarizeTranzilaResult("callback", req.method, parsed);

  // Redacted by construction: `summary` holds no token and no PAN, only the
  // last 4 digits and the field NAMES that were present.
  console.log("[tranzila] callback result", JSON.stringify(summary));

  if (url.searchParams.get("diag") === "1") {
    return new Response(htmlBody(summary), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  const failed = url.searchParams.get("status") === "failed";
  const target = parsed.approved && !failed ? "/billing?success=1" : "/billing?canceled=1";

  // 303 so the browser turns Tranzila's POST into a GET on /billing; a 302
  // would re-POST the transaction payload at a React page.
  return new Response(null, {
    status: 303,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

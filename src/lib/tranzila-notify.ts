import { createClient } from "@supabase/supabase-js";
import { parseHostedPaymentResult } from "./tranzila";
import {
  readTranzilaPayload,
  summarizeTranzilaResult,
  payloadTooLarge,
  rateLimited,
} from "./tranzila-callback";
import {
  activateFromTranzilaNotify,
  CHECKOUT_NONCE_PARAM,
} from "./tranzila-activation";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * /api/tranzila/notify - the server-to-server copy of a DirectNG hosted-page
 * result (`notify_url_address`), and the ONLY writer in the Tranzila flow.
 *
 * Authentication is the single-use intent nonce on the query string, consumed
 * atomically in src/lib/tranzila-activation.ts. The nonce never appears on the
 * browser-facing success/fail URLs, is never logged by us, and is never echoed
 * back.
 *
 * (It does land in the PLATFORM's request log, because Vercel records request
 * URLs including query strings. That is why it is single-use, short-lived and
 * only ever useful for one specific pending checkout: an operator reading our
 * own logs is not the threat model, and a nonce that has been consumed is
 * worth nothing. If Tranzila ever supports a custom request header or a
 * signed payload, move it off the URL.)
 *
 * Provider gate: this route is inert unless PAYMENT_PROVIDER=tranzila, so a
 * stray POST while Polar is live cannot touch anyone's plan. Note that this is
 * a gate on OUR side only - the intent nonce is what proves a request belongs
 * to a checkout we started.
 *
 * The response body is deliberately uniform ({ok:true, received:true}). Telling
 * an unauthenticated caller "that nonce was already used" versus "no such
 * nonce" would turn this endpoint into an oracle. Everything interesting goes
 * to the server log instead.
 *
 * Always 200 on a payload we could read, even when we ignore it: a non-2xx
 * makes Tranzila retry, and retrying a result we deliberately refused helps
 * nobody. 413 (over the body cap) and 429 (per-IP ceiling) are the exceptions.
 */
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER === "tranzila" ? "tranzila" : "other";

export async function handleTranzilaNotify(req: Request): Promise<Response> {
  const limited = rateLimited(req, "notify");
  if (limited) return limited;

  const { params, oversize } = await readTranzilaPayload(req);
  if (oversize) return payloadTooLarge("notify");

  const parsed = parseHostedPaymentResult(params);
  const summary = summarizeTranzilaResult("notify", req.method, parsed);
  // Redacted by construction: no token, no PAN, no nonce. Field NAMES only.
  console.log("[tranzila] notify result", JSON.stringify(summary));

  if (PAYMENT_PROVIDER !== "tranzila") {
    console.warn("[tranzila-notify] PAYMENT_PROVIDER is not tranzila, ignoring");
    return ok();
  }

  const nonce = new URL(req.url).searchParams.get(CHECKOUT_NONCE_PARAM);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const result = await activateFromTranzilaNotify(admin, parsed, nonce);
    // Outcome and any alert go to the log, never to the caller.
    console.log("[tranzila-notify] outcome", result.outcome);
    if (result.alert) console.error("[tranzila-notify]", result.alert);
  } catch (err) {
    // A throw here means a verified capture may have been left half-written.
    // Alert; do not retry automatically (the nonce is already burned, so a
    // retry would be ignored anyway) and never surface the detail.
    console.error("[tranzila-notify] [ALERT] activation threw", err);
  }

  return ok();
}

function ok(): Response {
  return new Response(JSON.stringify({ ok: true, received: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

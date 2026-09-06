// Resend inbound webhook - "expenses from email".
//
// Transport shell only: prove Resend sent this, hand the event to
// src/lib/email-inbox.ts, and answer 200. Same posture as the WhatsApp and
// Polar webhooks - read the RAW body, verify the provider's signature over
// those exact bytes, treat a failed check as a hard reject.
//
// This endpoint uploads a file and pays for an OCR call against a real
// business's monthly quota, so an unverified POST is an anonymous stranger
// spending someone else's money. The signature check FAILS CLOSED: no
// RESEND_WEBHOOK_SECRET configured means nothing is processed.
//
// Processing is inline rather than queued. One inbound mail is up to five
// attachment downloads plus one scan each (~10-20s per attachment), scanned
// sequentially; the module stops starting new ones at 45s of the 60s budget
// and asks for a retry with what is left. Doing the work before answering
// means Resend's retry-until-2xx is a genuine retry of something that did not
// finish, not a duplicate of something that did - every item is claimed in
// the database first, so a redelivery can tell those two apart.
//
// The status code IS the instruction to Resend, so it is chosen carefully:
//   2xx  handled, or nothing to do. Stop.
//   429  the business's hourly ceiling. Nothing was written; come back later.
//   503  a database problem before any row existed. Nothing is lost yet.
//   500  partially done, or an unexpected throw. Redeliver and we resume.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRate, clientIp } from "@/lib/rate-limit";
import {
  processInboundEmail,
  svixHeadersFrom,
  verifyResendWebhook,
  type InboundEmailEvent,
  type InboundRetry,
} from "@/lib/email-inbox";

export const runtime = "nodejs";
export const maxDuration = 60;

/** What each retryable outcome asks Resend to do. See the header comment. */
const RETRY_STATUS: Record<InboundRetry, number> = {
  rate_limited: 429,
  db_error: 503,
  incomplete: 500,
  error: 500,
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  // Rate limit before the HMAC so a flood of forged bodies cannot burn CPU on
  // signature math. Resend's real traffic is nowhere near this.
  const ip = clientIp(req);
  const rl = checkRate({ key: `email-inbound:${ip}`, max: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const raw = await req.text();
  const verdict = verifyResendWebhook(raw, svixHeadersFrom(req.headers), secret);
  if (!verdict.ok) {
    if (verdict.reason === "no_secret") {
      // Misconfiguration, not an attack: 503 so Resend keeps retrying and the
      // mail is not lost once the env var is set.
      console.error("[email-inbox] RESEND_WEBHOOK_SECRET is not configured; inbound mail rejected");
      return NextResponse.json({ ok: false }, { status: 503 });
    }
    console.error(`[email-inbox] rejected webhook: ${verdict.reason}`);
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let event: InboundEmailEvent;
  try {
    event = JSON.parse(raw) as InboundEmailEvent;
  } catch {
    // Signed but unparseable: nothing to retry, do not make Resend redeliver.
    return NextResponse.json({ ok: true });
  }

  // Resend sends delivery events (email.sent, email.delivered, ...) on the
  // same endpoint if it is subscribed to them. Acknowledge and ignore.
  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const result = await processInboundEmail(admin, event);
    // The body is for our own tracing in the Resend dashboard - it says what
    // happened to a mail we accepted. It never carries the token, the address
    // or anything about the business.
    if (result.ok) return NextResponse.json(result);
    return NextResponse.json(result, { status: RETRY_STATUS[result.retry] });
  } catch (err) {
    // processInboundEmail already catches everything it can; this is the last
    // line of defence. A replay is safe now that every item is claimed in the
    // database: a redelivery either resumes a row nobody finished or finds
    // nothing to do, so asking for one is better than silently losing a mail.
    console.error("[email-inbox] inbound handler threw:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, retry: "error" }, { status: 500 });
  }
}

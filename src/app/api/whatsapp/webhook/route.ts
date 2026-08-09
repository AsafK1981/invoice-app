// Meta WhatsApp Cloud API webhook.
//
// Transport shell only: verify who sent this, hand each message to the
// conversation logic in src/lib/whatsapp/handlers.ts, and always answer 200.
//
// Follows the same posture as the Polar billing webhook
// (src/app/api/billing/webhook/route.ts): read the RAW body, verify the
// provider's signature over those exact bytes, and treat a failed check as a
// hard reject. This endpoint can create tax documents, so an unverified POST is
// an anonymous stranger with write access.

import { NextRequest, NextResponse } from "next/server";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { verifySignature, whatsappConfigured } from "@/lib/whatsapp/client";
import { handleMessage, type InboundMessage } from "@/lib/whatsapp/handlers";

export const runtime = "nodejs";
// Media download + two model calls + the Graph send can exceed the default.
export const maxDuration = 60;

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";

/**
 * Subscription handshake. Meta calls this once when the webhook URL is saved,
 * and echoes hub.challenge back verbatim as plain text.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  if (!whatsappConfigured()) {
    // The channel is off (no credentials). Answer 200 so Meta doesn't retry
    // forever against a deployment that will never process the message.
    return NextResponse.json({ ok: true });
  }

  // Rate limit before the HMAC so a flood of forged bodies can't burn CPU on
  // signature math. Meta's real traffic is far under this.
  const ip = clientIp(req);
  const rl = checkRate({ key: `wa-webhook:${ip}`, max: 300, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    console.error("[whatsapp] rejected: bad signature");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const messages = extractMessages(body);

  // Sequential on purpose. Messages from one user are a conversation, and a
  // confirm tap must not be processed before the draft it confirms. Volume here
  // is a handful per request, so there is nothing to gain from parallelism.
  for (const msg of messages) {
    try {
      await handleMessage(msg);
    } catch (err) {
      // Never let one bad message turn into a non-200: Meta would redeliver the
      // whole batch, replaying messages we already handled.
      console.error(
        "[whatsapp] handler threw:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({ ok: true });
}

interface WebhookBody {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: InboundMessage[];
        // statuses[] (sent/delivered/read receipts) also arrive here and are
        // deliberately ignored — acting on them would cost money for nothing.
      };
    }>;
  }>;
}

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";

function extractMessages(body: WebhookBody): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== "messages") continue;

      // Only accept events addressed to OUR business number. The HMAC proves
      // Meta sent this, not which of the app's numbers it was for — if this
      // Meta app ever hosts a second WhatsApp number, a correctly signed event
      // for that number would otherwise be processed here as though it were
      // ours. Cheap now, and the kind of check nobody adds after the fact.
      const target = change.value?.metadata?.phone_number_id;
      if (PHONE_NUMBER_ID && target && target !== PHONE_NUMBER_ID) {
        console.error(`[whatsapp] ignoring event for foreign number ${target}`);
        continue;
      }

      for (const msg of change.value?.messages ?? []) {
        if (msg?.id && msg?.from && msg?.type) out.push(msg);
      }
    }
  }
  return out;
}

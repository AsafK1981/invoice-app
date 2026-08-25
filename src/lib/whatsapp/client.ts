// Thin WhatsApp Cloud API client + inbound webhook verification.
//
// Meta's Cloud API is a plain HTTPS/JSON surface, so there is no SDK here on
// purpose: one fetch wrapper is smaller than the dependency and keeps the exact
// request shape visible.
//
// Cost note (matters, and it changes soon): every message we send from here is
// billable. Replies inside the 24-hour customer service window are free until
// 2026-09-30 and chargeable from 2026-10-01. Nothing in this file may send a
// message that the user did not directly trigger.

import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "";

/** Feature flag. The channel stays dark until every value above is present. */
export function whatsappConfigured(): boolean {
  return Boolean(PHONE_NUMBER_ID && ACCESS_TOKEN && APP_SECRET);
}

/**
 * Verifies Meta's `X-Hub-Signature-256` over the RAW request body.
 *
 * MUST be given the raw text, not a re-serialised object: JSON.stringify does
 * not round-trip byte-for-byte (key order, unicode escaping), so re-serialising
 * would make every signature fail - or worse, tempt someone to skip the check.
 *
 * Same posture as the Polar billing webhook: an unverified body is an anonymous
 * internet POST that can create tax documents, so a failed check is a hard 401.
 */
export function verifySignature(rawBody: string, header: string | null): boolean {
  if (!APP_SECRET || !header) return false;
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest();
    provided = Buffer.from(header.slice(prefix.length), "hex");
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

async function send(payload: Record<string, unknown>): Promise<void> {
  if (!whatsappConfigured()) {
    console.error("[whatsapp] send skipped: channel not configured");
    return;
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) {
    // Log the reason but never throw into the webhook handler: a thrown error
    // returns non-200 to Meta, which then redelivers the SAME inbound message.
    // For a channel that issues documents, redelivery is worse than a lost reply
    // (the dedupe table is the backstop, but we don't want to lean on it).
    const body = await res.text().catch(() => "");
    console.error(`[whatsapp] send failed ${res.status}: ${body.slice(0, 500)}`);
  }
}

export async function sendText(to: string, body: string): Promise<void> {
  await send({ to, type: "text", text: { preview_url: true, body } });
}

export interface Button {
  /** Echoed back to us as the reply id. Max 256 chars per Meta. */
  id: string;
  /** Max 20 chars per Meta; longer titles make the whole send fail. */
  title: string;
}

/**
 * Interactive reply buttons - the confirmation gate.
 *
 * This is the mechanism that keeps a misparsed sentence from becoming a real
 * tax document: the bot proposes, the user taps, and only the tap writes.
 * Meta allows at most 3 buttons.
 */
export async function sendButtons(
  to: string,
  body: string,
  buttons: Button[],
): Promise<void> {
  await send({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

/** Sends a PDF by public URL. Meta fetches the URL itself, so it must be public. */
export async function sendDocument(
  to: string,
  link: string,
  filename: string,
  caption?: string,
): Promise<void> {
  await send({ to, type: "document", document: { link, filename, caption } });
}

/**
 * Interactive LIST message: a single button that opens a picker of up to 10
 * rows. Used where 3 reply buttons are not enough (payment method). The
 * chosen row comes back as `interactive.list_reply.{id,title}` and is routed
 * exactly like a button tap.
 */
export async function sendList(
  to: string,
  body: string,
  buttonText: string,
  rows: { id: string; title: string; description?: string }[],
): Promise<void> {
  await send({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonText.slice(0, 20),
        sections: [
          {
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id.slice(0, 200),
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  });
}

/** Downloads inbound media (a photographed receipt) as base64. */
export async function fetchMedia(
  mediaId: string,
): Promise<{ base64: string; mimeType: string } | null> {
  if (!whatsappConfigured()) return null;
  const metaRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
  );
  if (!metaRes.ok) {
    console.error(`[whatsapp] media lookup failed ${metaRes.status}`);
    return null;
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) return null;

  const binRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!binRes.ok) {
    console.error(`[whatsapp] media download failed ${binRes.status}`);
    return null;
  }
  const buf = Buffer.from(await binRes.arrayBuffer());
  // Guard against a hostile or accidental huge upload before it reaches the
  // model: ~8MB of raw bytes is well past any real phone photo.
  if (buf.byteLength > 8_000_000) {
    console.error("[whatsapp] media too large:", buf.byteLength);
    return null;
  }
  return { base64: buf.toString("base64"), mimeType: meta.mime_type || "image/jpeg" };
}

// Expenses from email - the inbound side.
//
// Each business can switch on a personal forwarding address
// (`<inbox_token>@friendlyinvoice.co.il`). Mail sent there lands on Resend's
// inbound webhook, and this module turns every supported attachment into its
// own PENDING item in `email_inbox_items`: download it, store it in the
// private `expense-receipts` bucket, run the same OCR the manual scanner
// runs, and park the result for the owner to approve.
//
// Three rules shape everything here:
//
//   1. NOTHING is written to `expenses`. An expense feeds the VAT return and
//      the income-tax books, and this channel is fed by whatever arrives in an
//      inbox - including mail the owner did not send. A human approves every
//      row (src/app/api/email-inbox/items/[id]/route.ts).
//   2. Every item is OWNED by exactly one run. A row is born 'processing'
//      with a timestamp; only the run holding that claim may finish it, and a
//      claim older than 3 minutes belongs to a run that died and can be taken
//      over. That is what makes Resend's retry-until-2xx safe: a redelivery
//      either finds work to do or finds nothing to do, never a second scan of
//      something already in flight.
//   3. A failure the caller can retry answers with a non-2xx, so Resend
//      redelivers with backoff. A failure the owner has to look at becomes a
//      `failed` row with a reason they can read in the app, and a 200.
//
// Server-only: uses node:crypto and the service-role Supabase client.

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scanExpenseEvidence, type ScanMediaType } from "./expense-scan";
import { findGmailConfirmUrl, isGmailConfirmUrl } from "./gmail-confirm-url";
import { todayInIsrael } from "./date";
import { checkRate } from "./rate-limit";

export { findGmailConfirmUrl, isGmailConfirmUrl };

const RECEIPT_BUCKET = "expense-receipts";

/** Same persistent monthly cap the manual scanner uses - one shared budget. */
export const MONTHLY_SCAN_CAP = 300;

/**
 * Per-business inbound ceiling. In-memory (resets on cold start) like every
 * other limiter in this app, so it is a burst guard, not a monthly budget -
 * the monthly scan cap above is what actually bounds spend. 60/hour leaves
 * room for the legitimate spike (someone onboarding bulk-forwards a year of
 * invoices in one sitting) and still stops a mailing list or a loop between
 * two auto-forwarding accounts. Tripping it costs nothing: no row is written
 * and the webhook answers 429, so Resend redelivers after the window.
 */
const MAX_EMAILS_PER_HOUR = 60;

/** Attachments scanned per mail. A sixth becomes a `too_many` notice. */
export const MAX_ATTACHMENTS_PER_MAIL = 5;

/**
 * Size ceilings, applied to the BASE64 payload exactly as /api/expenses/scan
 * applies them, so the two channels cannot drift apart on what the model will
 * accept. The raw-byte cap below is the same number times 3/4, used both to
 * reject an oversized attachment from its metadata and to abort the download
 * the moment the stream passes it.
 */
const MAX_BASE64_IMAGE = 8_000_000;
const MAX_BASE64_PDF = 20_000_000;

const RESEND_API_BASE = "https://api.resend.com";

/** Svix tolerates a 5 minute clock skew; anything older is a replay. */
const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

/** How long a 'processing' claim is respected before another run may take it. */
const RESUME_AFTER_MS = 3 * 60_000;

/**
 * The whole webhook budget is 60s (maxDuration on the route). Stop starting
 * new attachments at 45s so the answer itself still fits, and let the retry
 * pick up what is left.
 */
const PIPELINE_DEADLINE_MS = 45_000;

/**
 * Failure reasons a retry can plausibly fix. A `failed` row carrying one of
 * these is re-claimed (and re-run) by a redelivery or a re-forward; every
 * other reason is the owner's answer and stays put - re-running a
 * `not_expense` would just pay for the same verdict twice.
 */
const RETRYABLE_REASONS: InboundFailure[] = ["rate_limited", "download_failed", "error", "quota"];

// ── the address ─────────────────────────────────────────────────────────────

/**
 * Alphabet with every ambiguous character removed (no 0/o, 1/l/i). The token
 * is read off a screen and typed into a mail client's forwarding rule, so a
 * character a human can misread is a support ticket.
 */
const TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // 31 chars, gitleaks:allow (an alphabet, not a key)
const TOKEN_LENGTH = 10;

/**
 * A new forwarding-address token. ~49 bits of entropy: the token IS the only
 * secret protecting the owner's pending queue, so it must not be guessable by
 * enumeration. Rejection sampling keeps the distribution uniform (a plain
 * modulo over 256 would bias the first 8 letters).
 */
export function generateInboxToken(): string {
  let out = "";
  while (out.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH * 2)) {
      if (byte >= 248) continue; // 248 = 8 * 31, the largest usable multiple
      out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
      if (out.length === TOKEN_LENGTH) break;
    }
  }
  return out;
}

/** The domain inbound mail is accepted on. Lowercase, no trailing dot. */
export function inboxDomain(): string {
  return (process.env.EMAIL_INBOX_DOMAIN || "friendlyinvoice.co.il")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

export function inboxAddressFor(token: string): string {
  return `${token}@${inboxDomain()}`;
}

/** `Name <a@b.com>` / `<a@b.com>` / `a@b.com` -> `a@b.com`, lowercased. */
export function bareAddress(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const angled = value.match(/<([^<>]+)>\s*$/);
  const addr = (angled ? angled[1] : value).trim().toLowerCase();
  return addr.includes("@") ? addr : null;
}

/**
 * The first recipient that belongs to our inbound domain, reduced to its
 * local part (the token).
 *
 * `received_for` is checked FIRST: it is Resend's record of the ENVELOPE
 * recipient, the address the mail was actually delivered to, and it is the
 * only one that survives a Bcc or a forwarding rule that rewrites the header
 * recipients. `to` and `cc` are header fields - anyone can write anything in
 * them - so they are the fallback, not the source of truth.
 *
 * A `+tag` suffix is stripped: some mail clients add one when forwarding, and
 * the token itself never contains `+`.
 */
export function parseInboxToken(addressLists: (string[] | string | null | undefined)[]): string | null {
  const domain = inboxDomain();
  for (const list of addressLists) {
    if (!list) continue;
    const entries = Array.isArray(list) ? list : [list];
    for (const entry of entries) {
      const addr = bareAddress(entry);
      if (!addr) continue;
      const at = addr.lastIndexOf("@");
      if (at <= 0) continue;
      if (addr.slice(at + 1) !== domain) continue;
      const local = addr.slice(0, at).split("+")[0];
      if (local) return local;
    }
  }
  return null;
}

/**
 * The token an inbound event was delivered to, or null.
 *
 * The ORDER of the three lists is the whole point of this function existing
 * separately from parseInboxToken: it decides which business pays for the
 * scan, so the envelope recipient is asked first and the header fields are
 * only a fallback.
 */
export function inboxTokenFromEvent(
  data: NonNullable<InboundEmailEvent["data"]>,
): string | null {
  return parseInboxToken([data.received_for, data.to, data.cc]);
}

// ── webhook signature (svix) ────────────────────────────────────────────────

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: "no_secret" | "missing_headers" | "stale" | "mismatch" };

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function svixHeadersFrom(headers: Headers): SvixHeaders {
  return {
    // Svix sends the `webhook-*` aliases too; accept either.
    id: headers.get("svix-id") ?? headers.get("webhook-id"),
    timestamp: headers.get("svix-timestamp") ?? headers.get("webhook-timestamp"),
    signature: headers.get("svix-signature") ?? headers.get("webhook-signature"),
  };
}

/**
 * Standard-webhooks / svix verification over the RAW body bytes.
 *
 * Signed content is `${id}.${timestamp}.${body}`, HMAC-SHA256 with the
 * base64-decoded secret, compared in constant time against every `v1,<sig>`
 * entry in the header (svix ships more than one during a secret rotation).
 *
 * FAILS CLOSED: no secret configured means no request is accepted. This
 * endpoint uploads files and pays for OCR on behalf of a real business, so an
 * unverified POST is an anonymous stranger spending the owner's quota.
 */
export function verifyResendWebhook(
  rawBody: string,
  headers: SvixHeaders,
  secret: string | undefined,
  nowMs: number = Date.now(),
): WebhookVerification {
  if (!secret) return { ok: false, reason: "no_secret" };
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const sentSeconds = Number(timestamp);
  if (!Number.isFinite(sentSeconds)) return { ok: false, reason: "missing_headers" };
  if (Math.abs(nowMs - sentSeconds * 1000) > SIGNATURE_TOLERANCE_MS) {
    return { ok: false, reason: "stale" };
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return { ok: false, reason: "no_secret" };

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(value, "base64");
    } catch {
      continue;
    }
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "mismatch" };
}

// ── the inbound event ───────────────────────────────────────────────────────

export interface InboundAttachmentMeta {
  id?: string;
  filename?: string;
  content_type?: string;
  content_disposition?: string;
  content_id?: string;
  size?: number;
}

export interface InboundEmailEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    received_for?: string[];
    message_id?: string;
    subject?: string;
    attachments?: InboundAttachmentMeta[];
  };
}

/** What happened to one attachment. One inbound mail can produce several. */
export interface InboundItemResult {
  itemId: string;
  index: number;
  status: "pending" | "failed";
  reason?: InboundFailure;
}

/**
 * Why the webhook should be redelivered rather than acknowledged:
 *   rate_limited  the business's hourly ceiling; nothing was written  -> 429
 *   db_error      the queue row does not exist yet, nothing is lost   -> 503
 *   incomplete    ran out of time, or another run still owns an item  -> 500
 *   error         an unexpected throw; the item is failed and re-claimable -> 500
 */
export type InboundRetry = "rate_limited" | "db_error" | "incomplete" | "error";

export type InboundResult =
  | { ok: true; ignored: "no_token" | "unknown_token" | "duplicate" | "no_email_id" }
  | { ok: true; items: InboundItemResult[] }
  | { ok: false; retry: InboundRetry };

export type InboundFailure =
  | "no_attachment"
  | "too_large"
  | "quota"
  | "rate_limited"
  | "download_failed"
  | "not_expense"
  | "unreadable"
  /** The same file is already pending or booked for this business. */
  | "duplicate"
  /** More attachments in one mail than we scan; the first five were taken. */
  | "too_many"
  /** Gmail's forwarding confirmation mail - a setup step, not a problem. */
  | "gmail_verification"
  | "error";

/** Sender of Gmail's "confirm this forwarding address" mail. */
const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";

/**
 * Is this Gmail's forwarding confirmation?
 *
 * EXACT mailbox match, never a substring: this decides that a mail is trusted
 * enough to have a link pulled out of its body and offered to the owner as a
 * button. A substring test would accept
 * `"forwarding-noreply@google.com" <attacker@evil.com>` - a display name
 * anyone can set - and hand the attacker that button.
 */
export function isGmailForwardingConfirmation(fromAddress: string | null | undefined): boolean {
  return bareAddress(fromAddress) === GMAIL_FORWARDING_SENDER;
}

const IMAGE_EXT: Record<string, ScanMediaType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

/**
 * The media type we would send to the model, or null when this attachment is
 * not something the scanner can read.
 *
 * Deliberately NOT normalizeMediaType(): that one defaults anything unknown to
 * image/jpeg, which is right for a file the user explicitly picked and wrong
 * here, where every signature.asc, calendar.ics and winmail.dat in the world
 * arrives unasked. Falls back to the filename extension only when the server
 * sent a generic content type.
 */
export function attachmentMediaType(att: InboundAttachmentMeta): ScanMediaType | null {
  const declared = String(att.content_type || "").split(";")[0].trim().toLowerCase();
  if (declared === "application/pdf") return "application/pdf";
  if (declared === "image/jpg" || declared === "image/jpeg") return "image/jpeg";
  if (declared === "image/png") return "image/png";
  if (declared === "image/webp") return "image/webp";
  if (declared === "image/gif") return "image/gif";

  const generic = !declared || declared === "application/octet-stream" || declared === "binary/octet-stream";
  if (!generic) return null;
  const ext = String(att.filename || "").split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXT[ext] ?? null;
}

export interface PickedAttachment {
  att: InboundAttachmentMeta;
  mediaType: ScanMediaType;
  /** Position in this list. Becomes email_inbox_items.attachment_index. */
  index: number;
}

/**
 * Every attachment worth scanning, in the order Resend listed them.
 *
 * The order is never rearranged, because the position IS the identity: it
 * becomes `attachment_index`, which is half the dedupe key and half the
 * expense's `source_ref`. A redelivery of the same mail must produce the same
 * indexes or the same receipt would be booked twice.
 *
 * Real attachments beat inline ones as a GROUP: inline parts are almost
 * always the sender's logo or signature image, so mixing them in would file
 * the letterhead as a receipt and pay for the privilege. Inline parts are
 * used only when the mail has nothing else - which is what a phone's "share
 * this photo by mail" produces.
 */
export function supportedAttachments(
  attachments: InboundAttachmentMeta[] | undefined,
): PickedAttachment[] {
  const supported = (attachments ?? [])
    .map((att) => ({ att, mediaType: attachmentMediaType(att) }))
    .filter((c): c is { att: InboundAttachmentMeta; mediaType: ScanMediaType } => c.mediaType !== null);
  const attached = supported.filter(
    (c) => String(c.att.content_disposition || "").toLowerCase() !== "inline",
  );
  const chosen = attached.length > 0 ? attached : supported;
  return chosen.map((c, index) => ({ ...c, index }));
}

function extForMediaType(mt: ScanMediaType): string {
  if (mt === "image/jpeg") return "jpg";
  if (mt === "image/png") return "png";
  if (mt === "image/webp") return "webp";
  if (mt === "image/gif") return "gif";
  return "pdf";
}

// ── the pipeline ────────────────────────────────────────────────────────────

interface InboxBusiness {
  id: string;
  user_id: string;
}

/** The columns that identify an item, shared by every claim attempt. */
interface ItemIdentity {
  business_id: string;
  email_id: string;
  message_id: string;
  from_address: string | null;
  subject: string | null;
  received_at: string;
}

type Claim =
  /** This run owns the row and must finish it. */
  | { kind: "claimed"; itemId: string }
  /** Another run took it less than RESUME_AFTER_MS ago. Come back later. */
  | { kind: "busy" }
  /** Already resolved (or failed for a reason a retry cannot fix). Nothing to do. */
  | { kind: "done" }
  | { kind: "db_error" };

/**
 * Handle one `email.received` event, end to end. Never throws.
 *
 * Ordering is not arbitrary:
 *   1. resolve the business (silent for an unknown/disabled token - the reply
 *      must not tell a stranger whether an address exists)
 *   2. the hourly ceiling, BEFORE any row is written, so a flood costs one
 *      SELECT and Resend is told to come back later rather than being handed
 *      a queue full of `rate_limited` rows the owner has to dismiss
 *   3. one row per attachment, claimed as 'processing' immediately before its
 *      own work starts - so a run that dies leaves at most one claimed row,
 *      and a run that runs out of time leaves the rest untouched for the retry
 *   4. only then download, upload, charge quota and scan
 */
export async function processInboundEmail(
  admin: SupabaseClient,
  event: InboundEmailEvent,
): Promise<InboundResult> {
  const startedAt = Date.now();
  const data = event.data ?? {};
  const emailId = String(data.email_id || "").trim();
  if (!emailId) return { ok: true, ignored: "no_email_id" };

  const token = inboxTokenFromEvent(data);
  if (!token) return { ok: true, ignored: "no_token" };

  const { data: business, error: bizErr } = await admin
    .from("businesses")
    .select("id, user_id")
    .eq("inbox_token", token)
    .eq("inbox_enabled", true)
    .maybeSingle();
  if (bizErr) {
    // A failed lookup is NOT an unknown token: answering 200 here would drop
    // a real receipt on the floor every time the database hiccups.
    console.error("[email-inbox] business lookup failed:", bizErr.message);
    return { ok: false, retry: "db_error" };
  }
  if (!business) return { ok: true, ignored: "unknown_token" };
  const biz = business as InboxBusiness;

  const burst = checkRate({
    key: `email-inbox:${biz.id}`,
    max: MAX_EMAILS_PER_HOUR,
    windowMs: 60 * 60_000,
  });
  if (!burst.ok) {
    console.warn(`[email-inbox] hourly ceiling reached for business ${biz.id}`);
    return { ok: false, retry: "rate_limited" };
  }

  // A forwarded mail carries its own Message-ID; when a sender omits one,
  // Resend's email_id is always present and is just as unique.
  const messageId = String(data.message_id || "").trim() || emailId;

  const identity: ItemIdentity = {
    business_id: biz.id,
    email_id: emailId,
    message_id: messageId,
    from_address: trimTo(data.from, 320),
    subject: trimTo(data.subject, 500),
    received_at: isoOrNow(data.created_at || event.created_at),
  };

  // Gmail's forwarding confirmation. Setting up auto-forwarding sends this
  // FIRST, before any receipt ever arrives, and the owner cannot answer it:
  // the mail was forwarded into our inbox, not theirs. So it never touches
  // the scanner (there is no receipt in it, and it must not spend quota) -
  // the confirmation link is pulled out of the body and handed to the app,
  // where one click finishes the setup.
  if (isGmailForwardingConfirmation(data.from)) {
    return handleGmailConfirmation(admin, biz, identity, emailId);
  }

  const supported = supportedAttachments(data.attachments);
  if (supported.length === 0) {
    return singleFailure(admin, identity, 0, "no_attachment");
  }

  const results: InboundItemResult[] = [];
  let busy = false;
  let dbError = false;
  let incomplete = false;
  let threw = false;

  // The overflow notice goes first, so a mail with fifteen attachments still
  // tells the owner what happened even if we run out of time below.
  if (supported.length > MAX_ATTACHMENTS_PER_MAIL) {
    const notice = await singleFailure(
      admin,
      identity,
      MAX_ATTACHMENTS_PER_MAIL,
      "too_many",
      String(supported.length),
    );
    if (notice.ok && "items" in notice) results.push(...notice.items);
    if (!notice.ok) return notice;
  }

  for (const candidate of supported.slice(0, MAX_ATTACHMENTS_PER_MAIL)) {
    // Checked BEFORE the claim: a claim we cannot honour would sit
    // 'processing' for three minutes before anyone else could take it.
    if (Date.now() - startedAt > PIPELINE_DEADLINE_MS) {
      console.warn(`[email-inbox] out of time after ${results.length} attachment(s); leaving the rest to the retry`);
      incomplete = true;
      break;
    }

    const claim = await claimItem(admin, identity, candidate.index);
    if (claim.kind === "db_error") {
      dbError = true;
      break;
    }
    if (claim.kind === "busy") {
      busy = true;
      continue;
    }
    if (claim.kind === "done") continue;

    try {
      const outcome = await runAttachment(admin, biz, claim.itemId, emailId, candidate);
      if (outcome) results.push(outcome);
    } catch (err) {
      console.error("[email-inbox] pipeline threw:", err instanceof Error ? err.message : err);
      await markFailed(admin, claim.itemId, "error");
      threw = true;
    }
  }

  if (dbError) return { ok: false, retry: "db_error" };
  if (threw) return { ok: false, retry: "error" };
  if (incomplete || busy) return { ok: false, retry: "incomplete" };
  if (results.length === 0) return { ok: true, ignored: "duplicate" };
  return { ok: true, items: results };
}

/**
 * Claim the row for (business, message, index), creating it if this is the
 * first time we have seen it.
 *
 * The INSERT is the fast path and the arbiter: the UNIQUE constraint decides
 * who wins a race, not a read-then-write. A duplicate key means the row is
 * already there, and only then do we ask whether it is ours to take.
 */
async function claimItem(
  admin: SupabaseClient,
  identity: ItemIdentity,
  index: number,
): Promise<Claim> {
  const { data, error } = await admin
    .from("email_inbox_items")
    .insert({
      ...identity,
      attachment_index: index,
      status: "processing",
      processing_started_at: new Date().toISOString(),
    })
    .select("id");

  if (!error) {
    const itemId = data?.[0]?.id as string | undefined;
    if (itemId) return { kind: "claimed", itemId };
    console.error("[email-inbox] insert returned no id");
    return { kind: "db_error" };
  }
  // 23505 = unique_violation: the row exists. Anything else is a real
  // database problem and must not be mistaken for "already handled".
  if (error.code !== "23505") {
    console.error("[email-inbox] queue insert failed:", error.message);
    return { kind: "db_error" };
  }
  return reclaimItem(admin, identity, index);
}

/**
 * Take over an existing row, or report why we cannot.
 *
 * Two rows are takeable:
 *   * 'processing' with a claim older than RESUME_AFTER_MS - the run that
 *     claimed it died (a timeout, a redeploy) and nobody is coming back.
 *   * 'failed' with a transient reason - a retry can plausibly do better.
 *
 * Both takeovers are single conditional UPDATEs with RETURNING, so two runs
 * arriving together cannot both believe they won.
 */
async function reclaimItem(
  admin: SupabaseClient,
  identity: ItemIdentity,
  index: number,
): Promise<Claim> {
  const stale = await admin
    .from("email_inbox_items")
    .update({ processing_started_at: new Date().toISOString() })
    .eq("business_id", identity.business_id)
    .eq("message_id", identity.message_id)
    .eq("attachment_index", index)
    .eq("status", "processing")
    .lt("processing_started_at", new Date(Date.now() - RESUME_AFTER_MS).toISOString())
    .select("id");
  if (stale.error) {
    console.error("[email-inbox] stale claim takeover failed:", stale.error.message);
    return { kind: "db_error" };
  }
  if (stale.data?.length) return { kind: "claimed", itemId: stale.data[0].id as string };

  const retried = await admin
    .from("email_inbox_items")
    .update({
      status: "processing",
      processing_started_at: new Date().toISOString(),
      reason: null,
      detail: null,
      resolved_at: null,
    })
    .eq("business_id", identity.business_id)
    .eq("message_id", identity.message_id)
    .eq("attachment_index", index)
    .eq("status", "failed")
    .in("reason", RETRYABLE_REASONS)
    .select("id");
  if (retried.error) {
    console.error("[email-inbox] failed-item retry claim failed:", retried.error.message);
    return { kind: "db_error" };
  }
  if (retried.data?.length) return { kind: "claimed", itemId: retried.data[0].id as string };

  // Neither takeover applied. Either someone else is working on it right now
  // (tell Resend to come back), or it is settled (acknowledge and stop).
  const { data: existing, error } = await admin
    .from("email_inbox_items")
    .select("status")
    .eq("business_id", identity.business_id)
    .eq("message_id", identity.message_id)
    .eq("attachment_index", index)
    .maybeSingle();
  if (error) {
    console.error("[email-inbox] item status read failed:", error.message);
    return { kind: "db_error" };
  }
  return existing?.status === "processing" ? { kind: "busy" } : { kind: "done" };
}

/** Create (or take over) one row purely to record a failure on it. */
async function singleFailure(
  admin: SupabaseClient,
  identity: ItemIdentity,
  index: number,
  reason: InboundFailure,
  detail: string | null = null,
): Promise<InboundResult> {
  const claim = await claimItem(admin, identity, index);
  if (claim.kind === "db_error") return { ok: false, retry: "db_error" };
  if (claim.kind === "busy") return { ok: false, retry: "incomplete" };
  if (claim.kind === "done") return { ok: true, ignored: "duplicate" };

  const won = await markFailed(admin, claim.itemId, reason, detail);
  if (!won) return { ok: true, ignored: "duplicate" };
  return { ok: true, items: [{ itemId: claim.itemId, index, status: "failed", reason }] };
}

async function handleGmailConfirmation(
  admin: SupabaseClient,
  biz: InboxBusiness,
  identity: ItemIdentity,
  emailId: string,
): Promise<InboundResult> {
  const claim = await claimItem(admin, identity, 0);
  if (claim.kind === "db_error") return { ok: false, retry: "db_error" };
  if (claim.kind === "busy") return { ok: false, retry: "incomplete" };
  if (claim.kind === "done") return { ok: true, ignored: "duplicate" };

  const apiKey = process.env.RESEND_API_KEY;
  const link = apiKey ? await fetchGmailConfirmUrl(emailId, apiKey) : null;
  console.log(
    `[email-inbox] gmail forwarding confirmation for business ${biz.id} (link ${link ? "found" : "not found"})`,
  );
  const won = await markFailed(admin, claim.itemId, "gmail_verification", link);
  if (!won) return { ok: true, ignored: "duplicate" };
  return {
    ok: true,
    items: [{ itemId: claim.itemId, index: 0, status: "failed", reason: "gmail_verification" }],
  };
}

/**
 * Download, store, dedupe, charge and scan ONE attachment.
 *
 * Returns null when the claim was lost mid-run (another run took the row over
 * after our three minutes elapsed): the row is not ours to report on, and
 * whatever we uploaded for it is cleaned up on the way out.
 */
async function runAttachment(
  admin: SupabaseClient,
  biz: InboxBusiness,
  itemId: string,
  emailId: string,
  candidate: PickedAttachment,
): Promise<InboundItemResult | null> {
  const { att, mediaType, index } = candidate;

  const fail = async (
    reason: InboundFailure,
    detail: string | null = null,
    receiptPath: string | null = null,
  ): Promise<InboundItemResult | null> => {
    // No expense will ever point at this object - do not leave it behind.
    if (receiptPath) await removeReceipt(admin, receiptPath);
    const won = await markFailed(admin, itemId, reason, detail, receiptPath !== null);
    return won ? { itemId, index, status: "failed", reason } : null;
  };

  const apiKey = process.env.RESEND_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !anthropicKey) {
    console.error("[email-inbox] missing RESEND_API_KEY or ANTHROPIC_API_KEY");
    return fail("error");
  }

  const isPdf = mediaType === "application/pdf";
  const base64Cap = isPdf ? MAX_BASE64_PDF : MAX_BASE64_IMAGE;
  const rawCap = Math.floor((base64Cap * 3) / 4);

  await admin
    .from("email_inbox_items")
    .update({
      attachment_name: trimTo(att.filename, 300),
      attachment_type: mediaType,
    })
    .eq("id", itemId)
    .eq("status", "processing");

  const remote = await fetchAttachmentBytes(emailId, att, mediaType, apiKey, rawCap);
  if (remote === "too_large") return fail("too_large");
  if (!remote) return fail("download_failed");

  const base64 = remote.toString("base64");
  if (base64.length > base64Cap) return fail("too_large");

  const receiptPath = `${biz.user_id}/${randomUUID()}.${extForMediaType(mediaType)}`;
  const { error: upErr } = await admin.storage
    .from(RECEIPT_BUCKET)
    .upload(receiptPath, remote, { contentType: mediaType, upsert: false });
  if (upErr) {
    console.error("[email-inbox] storage upload failed:", upErr.message);
    return fail("error");
  }

  // The path is recorded straight away, so a run that dies from here on leaves
  // a row that still knows which object belongs to it.
  const sha256 = createHash("sha256").update(remote).digest("hex");
  const stored = await admin
    .from("email_inbox_items")
    .update({ receipt_path: receiptPath, attachment_sha256: sha256 })
    .eq("id", itemId)
    .eq("status", "processing")
    .select("id");
  if (stored.error || !stored.data?.length) {
    if (stored.error) console.error("[email-inbox] receipt path write failed:", stored.error.message);
    await removeReceipt(admin, receiptPath);
    return null;
  }

  // The re-forward guard. message_id catches a redelivery of the SAME mail;
  // this catches the same PDF arriving in a different mail (the owner forwards
  // it again a week later, or the supplier resends it). Only pending and
  // approved count: a rejected twin means the owner already said no, and
  // letting the file back in is the honest behaviour.
  const twin = await admin
    .from("email_inbox_items")
    .select("id")
    .eq("business_id", biz.id)
    .eq("attachment_sha256", sha256)
    .in("status", ["pending", "approved"])
    .neq("id", itemId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (twin.error) {
    // Fail open: a broken dedupe read must not swallow a real receipt.
    console.error("[email-inbox] duplicate check failed:", twin.error.message);
  } else if (twin.data?.length) {
    return fail("duplicate", twin.data[0].id as string, receiptPath);
  }

  // Monthly cap immediately before the model call - after the download, the
  // size check and the upload, so nothing that was never going to be scanned
  // eats a scan. Shared with the manual scanner on purpose: both draw on the
  // same ANTHROPIC_API_KEY.
  const { data: monthlyCount, error: monthlyErr } = await admin.rpc("increment_expense_scan_usage", {
    p_user_id: biz.user_id,
    p_month: todayInIsrael().slice(0, 7),
  });
  if (monthlyErr) {
    // Fail open, same as /api/expenses/scan: a bug in the cap check must not
    // silently swallow the owner's receipts.
    console.error("[email-inbox] monthly usage check failed:", monthlyErr.message);
  } else if ((monthlyCount as number) > MONTHLY_SCAN_CAP) {
    // 'quota' is retryable on purpose: next month, or a re-forward after the
    // cap resets, runs this attachment again instead of losing it.
    return fail("quota", null, receiptPath);
  }

  let outcome;
  try {
    outcome = await scanExpenseEvidence({
      apiKey: anthropicKey,
      data: base64,
      mediaType,
      today: todayInIsrael(),
    });
  } catch (err) {
    console.error("[email-inbox] scan call failed:", err instanceof Error ? err.message : err);
    return fail("error", null, receiptPath);
  }

  if (!outcome.ok) {
    if (outcome.reason === "bad_response") {
      console.error("[email-inbox] unparseable model output");
    }
    return fail(outcome.reason === "not_expense" ? "not_expense" : "unreadable", null, receiptPath);
  }

  const f = outcome.fields;
  const { data: finished, error: updateErr } = await admin
    .from("email_inbox_items")
    .update({
      scan: {
        vendor: f.vendor,
        amount: f.amount,
        vatAmount: f.vatAmount,
        date: f.date,
        category: f.category,
        description: f.description,
        unreadFields: f.unreadFields,
        legibility: f.legibility,
        documentKind: f.documentKind,
      },
      status: "pending",
      reason: null,
      detail: null,
      processing_started_at: null,
    })
    .eq("id", itemId)
    .eq("status", "processing")
    .select("id");
  if (updateErr) {
    console.error("[email-inbox] item update failed:", updateErr.message);
    return fail("error", null, receiptPath);
  }
  if (!finished?.length) {
    // The claim expired and someone else finished this row. Ours is the
    // orphan: drop the object we uploaded and say nothing.
    console.warn("[email-inbox] claim lost before the scan landed; discarding this run's upload");
    await removeReceipt(admin, receiptPath);
    return null;
  }

  return { itemId, index, status: "pending" };
}

export type ListedAttachment = InboundAttachmentMeta & { download_url?: string };

/**
 * Find, in Resend's attachment listing, the entry the webhook payload told us
 * about. The listing is a second response with its own shape, so the two are
 * matched on identity first (id, then filename) and only then on anything
 * weaker.
 *
 * The weak path is deliberately narrow: an entry of the SAME media type, and
 * only when there is exactly one of them. That is the difference between "we
 * could not identify it" and "we grabbed whichever file came first" - and in
 * a mail carrying two PDFs the second reading would hand identical bytes to
 * two different items. Media type is also required of the filename match: a
 * listing that reuses a name for a different kind of file is not the file we
 * picked. No match returns null, which becomes a retryable download_failed.
 */
export function matchListedAttachment(
  list: ListedAttachment[],
  wanted: InboundAttachmentMeta,
  mediaType: ScanMediaType,
): ListedAttachment | null {
  const sameType = list.filter((a) => attachmentMediaType(a) === mediaType);
  return (
    (wanted.id ? list.find((a) => a.id === wanted.id) : undefined) ??
    (wanted.filename ? sameType.find((a) => a.filename === wanted.filename) : undefined) ??
    (sameType.length === 1 ? sameType[0] : undefined) ??
    null
  );
}

/**
 * Resend's Receiving API: list the attachments (which is where the signed
 * `download_url` lives - the webhook payload carries metadata only), find the
 * one we picked, and fetch its bytes. Returns "too_large" when the size blows
 * the cap, either from the declared size or from the stream itself.
 *
 * Everything about this call is hostile-input handling: the URL comes from an
 * API response, the bytes come from whoever sent the mail. So the URL must be
 * https, redirects are refused rather than followed somewhere else, both legs
 * have their own timeout, and the body is measured as it arrives instead of
 * being buffered first.
 */
async function fetchAttachmentBytes(
  emailId: string,
  wanted: InboundAttachmentMeta,
  mediaType: ScanMediaType,
  apiKey: string,
  rawCap: number,
): Promise<Buffer | "too_large" | null> {
  let res: Response;
  try {
    res = await fetch(`${RESEND_API_BASE}/emails/receiving/${encodeURIComponent(emailId)}/attachments`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.error("[email-inbox] attachment list failed:", err instanceof Error ? err.message : err);
    return null;
  }
  if (!res.ok) {
    console.error(`[email-inbox] attachment list failed: ${res.status}`);
    return null;
  }
  const body = (await res.json()) as {
    data?: Array<InboundAttachmentMeta & { download_url?: string }>;
  };
  const match = matchListedAttachment(body.data ?? [], wanted, mediaType);
  if (!match?.download_url) {
    console.error("[email-inbox] no download_url for the picked attachment");
    return null;
  }
  if (typeof match.size === "number" && match.size > rawCap) return "too_large";

  let url: URL;
  try {
    url = new URL(match.download_url);
  } catch {
    console.error("[email-inbox] attachment download_url is not a URL");
    return null;
  }
  if (url.protocol !== "https:") {
    console.error(`[email-inbox] refusing a non-https download_url (${url.protocol})`);
    return null;
  }

  let fileRes: Response;
  try {
    fileRes = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    console.error("[email-inbox] attachment download failed:", err instanceof Error ? err.message : err);
    return null;
  }
  if (!fileRes.ok) {
    console.error(`[email-inbox] attachment download failed: ${fileRes.status}`);
    return null;
  }
  const declared = Number(fileRes.headers.get("content-length") || 0);
  if (declared > rawCap) return "too_large";

  const reader = fileRes.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      // Content-Length is advisory and a stream can lie about it, so this is
      // the check that actually binds: stop reading the moment it is passed.
      if (total > rawCap) {
        await reader.cancel().catch(() => {});
        return "too_large";
      }
      chunks.push(value);
    }
  } catch (err) {
    console.error("[email-inbox] attachment stream failed:", err instanceof Error ? err.message : err);
    return null;
  }
  return Buffer.concat(chunks);
}

/**
 * The received mail's body, used only to pull Gmail's confirmation link out.
 * Nothing else in this module reads mail CONTENT - the webhook payload is
 * metadata by design, and receipts are read from the attachment.
 */
async function fetchGmailConfirmUrl(emailId: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${RESEND_API_BASE}/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.log(`[email-inbox] could not read confirmation mail: ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { text?: string; html?: string; subject?: string };
    return findGmailConfirmUrl(body.text, body.html);
  } catch (err) {
    console.log("[email-inbox] confirmation mail read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Settle an item as failed. Conditional on the row still being 'processing':
 * false means our claim expired and another run owns it now, so the caller
 * must not report on it (and must clean up whatever it uploaded).
 */
async function markFailed(
  admin: SupabaseClient,
  itemId: string,
  reason: InboundFailure,
  detail: string | null = null,
  clearReceipt = false,
): Promise<boolean> {
  const { data, error } = await admin
    .from("email_inbox_items")
    .update({
      status: "failed",
      reason,
      detail,
      processing_started_at: null,
      resolved_at: new Date().toISOString(),
      ...(clearReceipt ? { receipt_path: null } : {}),
    })
    .eq("id", itemId)
    .eq("status", "processing")
    .select("id");
  if (error) {
    console.error("[email-inbox] markFailed failed:", error.message);
    return false;
  }
  return Boolean(data?.length);
}

export async function removeReceipt(admin: SupabaseClient, path: string | null | undefined): Promise<void> {
  if (!path) return;
  const { error } = await admin.storage.from(RECEIPT_BUCKET).remove([path]);
  if (error) console.error("[email-inbox] receipt cleanup failed:", error.message);
}

function trimTo(value: unknown, max: number): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s.slice(0, max) : null;
}

function isoOrNow(value: unknown): string {
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

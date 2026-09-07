// "חבר את Gmail" - the direct import half of הוצאות מהמייל.
//
// The forwarding address (email-inbox.ts + the Resend webhook) needs the
// owner to build a Gmail filter by hand and can only ever see NEW mail. This
// module lets the owner authorise the app on Google once (OAuth, scope
// gmail.readonly) and then pulls invoice attachments straight from Gmail:
// a one-time backfill of past months, and a daily incremental sync (the
// project's Vercel plan allows cron jobs no more often than once a day).
//
// Everything AFTER the bytes are in hand is shared with the webhook path
// (`scanStoreAndQueue`): size caps, sha256 twin, same-mail same-charge twin,
// the monthly scan cap, the pending row. This file is only the Google side:
// the OAuth dance, the Gmail REST calls, and choosing which parts of a
// message are worth scanning.
//
// The Google app stays in "Testing" publishing status (up to 100 named test
// users). No verification, no CASA - the consent screen shows Google's
// "unverified app" warning and the UI tells the user how to get past it.
//
// Pure helpers (state signing, query builder, attachment picker, identity)
// are exported and unit-tested; the network functions take an access token
// and use fetch, no googleapis package.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GOOGLE_OAUTH_CLIENT_ID } from "./google-oauth-client-id";
import { decryptColumn, decryptColumnOrNull, encryptColumn } from "./crypto";
import {
  MAX_ATTACHMENTS_PER_MAIL,
  attachmentMediaType,
  claimInboxItem,
  failInboxItem,
  inboxDomain,
  recordAttachmentMeta,
  scanStoreAndQueue,
  sizeCapsFor,
  type InboxBusiness,
  type InboundItemResult,
  type ItemIdentity,
} from "./email-inbox";

type ScanMediaType = NonNullable<ReturnType<typeof attachmentMediaType>>;

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "openid", "email"] as const;
export const GMAIL_CALLBACK_PATH = "/api/gmail/callback";

/** How long a connect attempt stays valid between "חבר" and Google's redirect back. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// ── OAuth state: a signed, expiring note-to-self ───────────────────────────

export interface OAuthStatePayload {
  businessId: string;
  userId: string;
  /** Unix ms. */
  exp: number;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function stateKey(secret: string): Buffer {
  // Derive a purpose-bound key rather than using the column key directly, so
  // a state string can never double as anything else signed with that key.
  return createHmac("sha256", secret).update("gmail-oauth-state").digest();
}

/**
 * The `state` parameter we hand to Google and get back untouched. It binds the
 * callback to the business and user who pressed "חבר", so a stolen callback
 * URL cannot attach someone else's Gmail to this business, and it expires so
 * an old link cannot be replayed a week later.
 */
export function signOAuthState(payload: OAuthStatePayload, secret: string): string {
  if (!secret) throw new Error("oauth state: missing signing secret");
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac("sha256", stateKey(secret)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** Null on any problem: bad shape, bad signature, expired. Never throws. */
export function verifyOAuthState(
  state: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): OAuthStatePayload | null {
  if (!state || !secret) return null;
  const dot = state.indexOf(".");
  if (dot <= 0 || dot === state.length - 1) return null;
  const body = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = createHmac("sha256", stateKey(secret)).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.businessId !== "string" || typeof p.userId !== "string" || typeof p.exp !== "number") return null;
  if (p.exp <= now) return null;
  return { businessId: p.businessId, userId: p.userId, exp: p.exp };
}

// ── The Google side of OAuth ───────────────────────────────────────────────

export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  // offline + consent is what yields a refresh token every time, including
  // for a user who already granted once and is reconnecting.
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  clientSecret: string,
): Promise<GoogleTokens | null> {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error("[gmail-connect] code exchange failed:", res.status);
    return null;
  }
  const data = (await res.json().catch(() => null)) as GoogleTokens | null;
  return data && typeof data.access_token === "string" ? data : null;
}

export type RefreshOutcome =
  | { ok: true; accessToken: string }
  /** Google says the grant is gone (revoked, password change, expired test-user token). */
  | { ok: false; reason: "revoked" }
  | { ok: false; reason: "unavailable" };

export async function refreshAccessToken(refreshToken: string, clientSecret: string): Promise<RefreshOutcome> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (res.ok && typeof data.access_token === "string") return { ok: true, accessToken: data.access_token };
  if (res.status === 400 || res.status === 401 || data.error === "invalid_grant") {
    return { ok: false, reason: "revoked" };
  }
  return { ok: false, reason: "unavailable" };
}

/** Best effort: a failed revoke must not block a disconnect. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* ignore */
  }
}

/**
 * The account e-mail from the id_token Google returned alongside the code.
 * No signature check: the token arrived over TLS from Google's own token
 * endpoint in the same response as the access token, so its issuer is not in
 * question. It is used for display and for the one-account-per-business row.
 */
export function emailFromIdToken(idToken: string | null | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

// ── What to look for ───────────────────────────────────────────────────────

/** YYYY-MM-DD -> YYYY/MM/DD, the only date form Gmail search accepts. */
function gmailDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "/");
}

/**
 * The Gmail search that stands in for the filter the user no longer needs:
 * mail with an attachment whose subject or body mentions an invoice or a
 * receipt in Hebrew or English. Chats, the user's own outgoing mail and
 * anything addressed to our own inbox domain (their earlier forwards) are
 * left out; the sha256 guard downstream catches whatever slips through.
 */
export function buildGmailQuery(opts: { after?: string | null; before?: string | null; domain?: string } = {}): string {
  const domain = opts.domain ?? inboxDomain();
  const parts = [
    "has:attachment",
    "(חשבונית OR קבלה OR invoice OR receipt)",
    "-in:chats",
    "-from:me",
    `-to:${domain}`,
  ];
  if (opts.after) parts.push(`after:${gmailDate(opts.after)}`);
  if (opts.before) parts.push(`before:${gmailDate(opts.before)}`);
  return parts.join(" ");
}

// ── Gmail REST ─────────────────────────────────────────────────────────────

export class GmailApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function gmailGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new GmailApiError(res.status, `gmail ${res.status} on ${path.split("?")[0]}`);
  return (await res.json()) as T;
}

export interface GmailListPage {
  ids: string[];
  nextPageToken: string | null;
}

export async function listMessageIds(
  accessToken: string,
  q: string,
  pageToken: string | null,
  maxResults: number,
): Promise<GmailListPage> {
  const params = new URLSearchParams({ q, maxResults: String(maxResults) });
  if (pageToken) params.set("pageToken", pageToken);
  const data = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(
    accessToken,
    `/messages?${params.toString()}`,
  );
  return {
    ids: (data.messages ?? []).map((m) => m.id),
    nextPageToken: data.nextPageToken ?? null,
  };
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  /** Epoch ms as a string. */
  internalDate?: string;
  payload?: GmailPart;
}

export async function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(accessToken, `/messages/${encodeURIComponent(id)}?format=full`);
}

export async function getAttachmentBytes(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const data = await gmailGet<{ data?: string; size?: number }>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  return Buffer.from(data.data ?? "", "base64url");
}

// ── Reading a message ──────────────────────────────────────────────────────

export function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const h = (headers ?? []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value?.trim() || null;
}

export interface PickedGmailAttachment {
  /** Position among the picked attachments; becomes attachment_index. */
  index: number;
  attachmentId: string;
  filename: string;
  mediaType: ScanMediaType;
  size: number;
}

/**
 * Walk the MIME tree and keep the parts worth scanning: real attachments
 * (a filename and an attachmentId) of a type the scanner accepts. Inline
 * parts - the logo in a signature, a tracking pixel - carry a Content-ID or
 * an inline disposition and are skipped, otherwise every newsletter would
 * cost a scan. Same per-mail ceiling as the webhook path.
 */
export function pickGmailAttachments(payload: GmailPart | undefined): PickedGmailAttachment[] {
  const out: PickedGmailAttachment[] = [];
  const walk = (part: GmailPart | undefined) => {
    if (!part) return;
    const attachmentId = part.body?.attachmentId;
    const filename = (part.filename ?? "").trim();
    if (attachmentId && filename) {
      const disposition = headerValue(part.headers, "Content-Disposition");
      const contentId = headerValue(part.headers, "Content-ID");
      const inline = Boolean(contentId) || (disposition ?? "").toLowerCase().startsWith("inline");
      const mediaType = inline
        ? null
        : attachmentMediaType({
            filename,
            content_type: part.mimeType,
            content_disposition: disposition ?? undefined,
            content_id: contentId ?? undefined,
            size: part.body?.size,
          });
      if (mediaType) {
        out.push({ index: out.length, attachmentId, filename, mediaType, size: part.body?.size ?? 0 });
      }
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return out.slice(0, MAX_ATTACHMENTS_PER_MAIL);
}

/**
 * The row identity a Gmail message maps to. `message_id` carries a `gmail:`
 * prefix so it can never collide with a Message-ID the webhook recorded for
 * the same mail forwarded by hand (the sha256 guard handles that overlap).
 */
export function gmailMessageIdentity(businessId: string, msg: GmailMessage): ItemIdentity {
  const headers = msg.payload?.headers;
  const ms = Number(msg.internalDate);
  return {
    business_id: businessId,
    email_id: msg.id,
    message_id: `gmail:${msg.id}`,
    from_address: headerValue(headers, "From")?.slice(0, 300) ?? null,
    subject: headerValue(headers, "Subject")?.slice(0, 500) ?? null,
    received_at: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date().toISOString(),
    origin: "gmail",
  };
}

// ── Connected accounts ─────────────────────────────────────────────────────

export interface EmailAccountRow {
  id: string;
  business_id: string;
  email: string;
  refresh_token_enc: string;
  scope: string;
  connected_at: string;
  last_sync_at: string | null;
  last_backfill_at: string | null;
  last_error: string | null;
}

export const EMAIL_ACCOUNT_COLUMNS =
  "id, business_id, email, refresh_token_enc, scope, connected_at, last_sync_at, last_backfill_at, last_error";

export async function getGmailAccount(admin: SupabaseClient, businessId: string): Promise<EmailAccountRow | null> {
  const { data, error } = await admin
    .from("email_accounts")
    .select(EMAIL_ACCOUNT_COLUMNS)
    .eq("business_id", businessId)
    .eq("provider", "gmail")
    .maybeSingle();
  if (error) {
    console.error("[gmail-connect] account read failed:", error.message);
    return null;
  }
  return (data as EmailAccountRow | null) ?? null;
}

export async function saveGmailAccount(
  admin: SupabaseClient,
  businessId: string,
  email: string,
  refreshToken: string,
  scope: string,
): Promise<boolean> {
  const { error } = await admin.from("email_accounts").upsert(
    {
      business_id: businessId,
      provider: "gmail",
      email,
      refresh_token_enc: encryptColumn(refreshToken),
      scope,
      connected_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id,provider" },
  );
  if (error) console.error("[gmail-connect] account save failed:", error.message);
  return !error;
}

/**
 * Revoke at Google every grant these businesses hold, before their rows go.
 * Used by the two account-wipe routes: deleting our copy of the token is not
 * the same as ending the permission, and a user who deleted their account
 * should not find the app still listed under "third-party access" in Google.
 * Best effort per token; the wipe proceeds either way.
 */
export async function revokeGmailGrantsFor(admin: SupabaseClient, businessIds: string[]): Promise<number> {
  if (businessIds.length === 0) return 0;
  const { data, error } = await admin
    .from("email_accounts")
    .select("refresh_token_enc")
    .in("business_id", businessIds);
  if (error || !data) return 0;
  let revoked = 0;
  for (const row of data) {
    const token = decryptColumnOrNull((row as { refresh_token_enc: string }).refresh_token_enc);
    if (!token) continue;
    await revokeToken(token);
    revoked += 1;
  }
  return revoked;
}

// ── The import ─────────────────────────────────────────────────────────────

export interface GmailSyncRequest {
  mode: "backfill" | "incremental";
  /** YYYY-MM-DD, inclusive lower bound on the mail date. */
  after?: string | null;
  /** YYYY-MM-DD, exclusive upper bound. */
  before?: string | null;
  pageToken?: string | null;
}

export interface GmailSyncResult {
  /** No more pages, or a stop that a retry cannot fix right now (quota, auth). */
  done: boolean;
  nextPageToken: string | null;
  /** Messages fetched and looked at in this batch. */
  messages: number;
  /** Attachments that became pending cards. */
  queued: number;
  /** Attachments settled as failed (unreadable, too large, not an expense...). */
  failed: number;
  /** Attachments already in the queue or the books, or messages without a scannable file. */
  skipped: number;
  quotaHit: boolean;
  /** Google refused the refresh token: the owner must reconnect. */
  authError: boolean;
  /** Gmail rate limit or outage: come back later. */
  throttled: boolean;
}

export interface GmailSyncOptions {
  clientSecret: string;
  /** Wall-clock budget for this call; stop between messages once spent. */
  budgetMs: number;
  /** Messages fetched per page. */
  maxMessages: number;
}

/**
 * One bounded batch of the import. Lists a page of matching messages, and
 * for each one claims a queue row per scannable attachment and runs the
 * shared scan tail. Idempotent by construction: a row that already exists
 * for (business, gmail:<id>, index) is skipped, a failed one is retried,
 * so re-running a backfill costs only Gmail metadata calls.
 *
 * Returns `done:false` with a page token (or the same token when the time
 * budget ran out mid-page) so a caller can loop; the client does exactly that.
 */
export async function importGmailBatch(
  admin: SupabaseClient,
  account: EmailAccountRow,
  biz: InboxBusiness,
  req: GmailSyncRequest,
  opts: GmailSyncOptions,
): Promise<GmailSyncResult> {
  const startedAt = Date.now();
  const result: GmailSyncResult = {
    done: false,
    nextPageToken: req.pageToken ?? null,
    messages: 0,
    queued: 0,
    failed: 0,
    skipped: 0,
    quotaHit: false,
    authError: false,
    throttled: false,
  };

  let refreshToken: string;
  try {
    refreshToken = decryptColumn(account.refresh_token_enc);
  } catch {
    console.error("[gmail-connect] stored token cannot be decrypted");
    return { ...result, done: true, authError: true };
  }
  const refreshed = await refreshAccessToken(refreshToken, opts.clientSecret);
  if (!refreshed.ok) {
    if (refreshed.reason === "revoked") return { ...result, done: true, authError: true };
    return { ...result, throttled: true };
  }
  const access = refreshed.accessToken;

  const q = buildGmailQuery({ after: req.after ?? null, before: req.before ?? null });

  let page: GmailListPage;
  try {
    page = await listMessageIds(access, q, req.pageToken ?? null, opts.maxMessages);
  } catch (err) {
    return classifyGmailError(err, result);
  }

  for (const id of page.ids) {
    if (Date.now() - startedAt > opts.budgetMs) {
      // Out of time mid-page: hand the SAME page back. Rows already done are
      // skipped on the retry, so nothing is scanned twice.
      return { ...result, done: false, nextPageToken: req.pageToken ?? null };
    }

    let msg: GmailMessage;
    try {
      msg = await getMessage(access, id);
    } catch (err) {
      return classifyGmailError(err, { ...result, nextPageToken: req.pageToken ?? null });
    }
    result.messages += 1;

    const picks = pickGmailAttachments(msg.payload);
    if (picks.length === 0) {
      result.skipped += 1;
      continue;
    }
    const identity = gmailMessageIdentity(biz.id, msg);

    for (const pick of picks) {
      // Checked per attachment as well as per message: one mail with five
      // slow PDFs must not carry a batch past the route's time limit. The
      // same page comes back; rows already done are skipped on the retry.
      if (Date.now() - startedAt > opts.budgetMs) {
        return { ...result, done: false, nextPageToken: req.pageToken ?? null };
      }
      const claim = await claimInboxItem(admin, identity, pick.index);
      if (claim.kind === "db_error") return { ...result, throttled: true, nextPageToken: req.pageToken ?? null };
      if (claim.kind === "busy" || claim.kind === "done") {
        result.skipped += 1;
        continue;
      }

      await recordAttachmentMeta(admin, claim.itemId, pick.filename, pick.mediaType);

      const { raw: rawCap } = sizeCapsFor(pick.mediaType);
      if (pick.size > rawCap) {
        await failInboxItem(admin, claim.itemId, pick.index, "too_large");
        result.failed += 1;
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = await getAttachmentBytes(access, msg.id, pick.attachmentId);
      } catch (err) {
        await failInboxItem(admin, claim.itemId, pick.index, "download_failed");
        result.failed += 1;
        if (err instanceof GmailApiError && (err.status === 401 || err.status === 429)) {
          return classifyGmailError(err, { ...result, nextPageToken: req.pageToken ?? null });
        }
        continue;
      }
      if (bytes.length === 0 || bytes.length > rawCap) {
        await failInboxItem(admin, claim.itemId, pick.index, bytes.length === 0 ? "download_failed" : "too_large");
        result.failed += 1;
        continue;
      }

      const outcome: InboundItemResult | null = await scanStoreAndQueue({
        admin,
        biz,
        itemId: claim.itemId,
        messageId: identity.message_id,
        index: pick.index,
        mediaType: pick.mediaType,
        bytes,
      });
      if (!outcome) {
        result.skipped += 1;
      } else if (outcome.status === "pending") {
        result.queued += 1;
      } else {
        result.failed += 1;
        if (outcome.reason === "quota") {
          // The month's scans are spent. Stop here; nothing more can succeed.
          return { ...result, done: true, quotaHit: true, nextPageToken: null };
        }
      }
    }
  }

  return { ...result, done: page.nextPageToken === null, nextPageToken: page.nextPageToken };
}

function classifyGmailError(err: unknown, result: GmailSyncResult): GmailSyncResult {
  if (err instanceof GmailApiError) {
    if (err.status === 401 || err.status === 403) return { ...result, done: true, authError: true };
    if (err.status === 429 || err.status >= 500) return { ...result, throttled: true };
  }
  console.error("[gmail-connect] gmail call failed:", err instanceof Error ? err.message : err);
  return { ...result, throttled: true };
}

/** YYYY-MM-DD for "n days before now", in UTC, for the incremental watermark. */
export function daysAgoIso(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60_000);
  return d.toISOString().slice(0, 10);
}

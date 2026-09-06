// Web Push sender. The device-facing half of the notifications the app
// already writes: `createNotificationForBusiness` (and the one client-side
// producer, through /api/push/send) call in here after a row lands, and this
// module decides whether the owner asked for that kind on their devices.
//
// Three rules shape everything below:
//
//  1. A push failure must never become a producer failure. Issuing an
//     invoice, running the dunning cron or importing a bank file cannot break
//     because a push service was slow or a VAPID key was missing. Everything
//     here swallows its own errors and returns a summary instead.
//  2. Endpoints are capability URLs. They are read here and nowhere else -
//     never returned by an API route, never logged, never rendered.
//  3. A dead endpoint is deleted, not retried. 404/410 from the push service
//     is the browser telling us the subscription is gone for good.
//
// The delivery core takes its dependencies as an argument so the tests can
// drive it without a database or a network (see tests/push-server.test.ts);
// `sendPushForNotification` is the thin wrapper that builds the real ones.

import webpush from "web-push";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSafeHref, type NotificationKind } from "./notifications";

/** Where a push lands when the notification carried no (or an unsafe) href. */
export const PUSH_FALLBACK_URL = "/notifications";

/** Push services are told to hold an undelivered message for one day. */
export const PUSH_TTL_SECONDS = 60 * 60 * 24;

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What the service worker receives, after JSON.parse. */
export interface PushPayload {
  title: string;
  body?: string;
  url: string;
  kind: NotificationKind | "test";
  id?: string;
}

export interface SendPushArgs {
  businessId: string;
  /** "test" is the settings screen proving the device works; see deliverPush. */
  kind: NotificationKind | "test";
  title: string;
  body?: string;
  href?: string;
  notificationId?: string;
}

export interface PushSendResult {
  /** How many devices accepted the push. */
  sent: number;
  /** How many dead subscriptions were deleted along the way. */
  removed: number;
  /** True when the owner did not opt this kind in (nothing was attempted). */
  skipped: boolean;
}

const EMPTY_RESULT: PushSendResult = { sent: 0, removed: 0, skipped: true };

/**
 * The two things delivery needs from the outside world. Injected so the
 * tests can assert on behaviour (skip / delete / fallback url) instead of
 * mocking a module graph.
 */
export interface PushDeps {
  /** Opted-in kinds for the business, or null when it could not be read. */
  loadKinds(businessId: string): Promise<string[] | null>;
  loadSubscriptions(businessId: string): Promise<PushSubscriptionRow[]>;
  /** Rejects with an error carrying `statusCode` for an HTTP failure. */
  send(sub: PushSubscriptionRow, payload: string): Promise<void>;
  deleteSubscription(id: string): Promise<void>;
  markUsed(id: string): Promise<void>;
}

/** web-push rejects with an error carrying the push service's status code. */
function statusCodeOf(err: unknown): number | null {
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = (err as { statusCode?: unknown }).statusCode;
    if (typeof code === "number") return code;
  }
  return null;
}

/**
 * Delivery core. Sends `payload` to every device of the business, deleting the
 * ones the push service says are gone.
 *
 * `matchKinds: false` bypasses the per-kind opt-in and is used by exactly one
 * caller: the "send me a test" button in settings, which has to be able to
 * prove the device works before any kind is switched on.
 */
export async function deliverPush(
  deps: PushDeps,
  args: SendPushArgs,
  options: { matchKinds?: boolean } = {},
): Promise<PushSendResult> {
  const matchKinds = options.matchKinds !== false;

  if (matchKinds) {
    const kinds = await deps.loadKinds(args.businessId);
    // null = the column could not be read (un-migrated database). Treated the
    // same as "nothing opted in": quiet, and never an exception at a producer.
    if (!kinds || !kinds.includes(args.kind)) return EMPTY_RESULT;
  }

  const subs = await deps.loadSubscriptions(args.businessId);
  if (subs.length === 0) return { sent: 0, removed: 0, skipped: false };

  const payload: PushPayload = {
    title: args.title,
    body: args.body,
    // Never let a sloppy producer navigate the device off-site: the same
    // guard the in-app feed applies, with the notification centre as the
    // fallback so a click always lands somewhere useful.
    url: isSafeHref(args.href) ? args.href : PUSH_FALLBACK_URL,
    kind: args.kind,
    id: args.notificationId,
  };
  const body = JSON.stringify(payload);

  let sent = 0;
  let removed = 0;

  for (const sub of subs) {
    try {
      await deps.send(sub, body);
      sent++;
      await deps.markUsed(sub.id).catch(() => {});
    } catch (err) {
      const code = statusCodeOf(err);
      if (code === 404 || code === 410) {
        await deps.deleteSubscription(sub.id).catch(() => {});
        removed++;
        continue;
      }
      // Anything else (a 5xx from the push service, a network blip) is a
      // transient the app does not retry: the notification itself is already
      // in the feed, which is the durable channel.
      console.warn("[push] send failed:", code ?? (err instanceof Error ? err.message : err));
    }
  }

  return { sent, removed, skipped: false };
}

let vapidReady: boolean | null = null;

/** Configures web-push once. Returns false when the keys are not deployed. */
function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    // Logged once per process, not per notification: a missing key is a
    // deployment fact, not an event.
    console.warn("[push] VAPID keys are not configured - web push is off.");
    vapidReady = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidReady = true;
  } catch (err) {
    console.warn("[push] VAPID configuration rejected:", err instanceof Error ? err.message : err);
    vapidReady = false;
  }
  return vapidReady;
}

/** Test seam: lets a suite re-evaluate the env instead of a cached answer. */
export function resetVapidForTests(): void {
  vapidReady = null;
}

let cachedAdmin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return cachedAdmin;
}

/** The real dependencies: service-role Supabase + the web-push library. */
export function createPushDeps(client: SupabaseClient = admin()): PushDeps {
  return {
    async loadKinds(businessId) {
      const { data, error } = await client
        .from("businesses")
        .select("push_kinds")
        .eq("id", businessId)
        .maybeSingle();
      if (error || !data) return null;
      const kinds = (data as { push_kinds?: unknown }).push_kinds;
      return Array.isArray(kinds) ? kinds.map(String) : [];
    },
    async loadSubscriptions(businessId) {
      const { data, error } = await client
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("business_id", businessId);
      if (error || !data) return [];
      return data as PushSubscriptionRow[];
    },
    async send(sub, payload) {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: PUSH_TTL_SECONDS },
      );
    },
    async deleteSubscription(id) {
      await client.from("push_subscriptions").delete().eq("id", id);
    },
    async markUsed(id) {
      await client
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", id);
    },
  };
}

/**
 * Fire a push for a notification that was just written. Never throws; a
 * caller that does not care about the outcome can ignore the result.
 */
export async function sendPushForNotification(
  args: SendPushArgs,
  options: { matchKinds?: boolean } = {},
): Promise<PushSendResult> {
  try {
    if (!ensureVapid()) return EMPTY_RESULT;
    return await deliverPush(createPushDeps(), args, options);
  } catch (err) {
    console.warn("[push] delivery failed:", err instanceof Error ? err.message : err);
    return EMPTY_RESULT;
  }
}

/** The copy of the "does this device work?" push from the settings card. */
export const PUSH_TEST_TITLE = "ההתרעות פועלות";
export const PUSH_TEST_BODY = "זו התרעת בדיקה מהאפליקציה. אפשר לסגור אותה.";

/**
 * Sends the test push to every device of the business, ignoring `push_kinds`
 * on purpose: the owner is asking "will this device show anything at all?",
 * which has to be answerable before they pick which kinds to receive.
 */
export function sendTestPush(businessId: string): Promise<PushSendResult> {
  return sendPushForNotification(
    {
      businessId,
      kind: "test",
      title: PUSH_TEST_TITLE,
      body: PUSH_TEST_BODY,
      href: PUSH_FALLBACK_URL,
    },
    { matchKinds: false },
  );
}

// ---------------------------------------------------------------------------
// Subscription payload validation (used by /api/push/subscribe)
// ---------------------------------------------------------------------------

/** Base64url alphabet, padding tolerated (some browsers include it). */
const KEY_RE = /^[A-Za-z0-9_-]{1,510}={0,2}$/;
const MAX_ENDPOINT_CHARS = 1024;
const MAX_USER_AGENT_CHARS = 256;

export interface ParsedPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export type ParsePushSubscriptionResult =
  | { ok: true; value: ParsedPushSubscription }
  | { ok: false; error: string };

/**
 * Validates what the browser POSTs before it reaches the database. The keys
 * are stored and later fed to a crypto library, and the endpoint is a URL the
 * server will make requests to, so both are checked for shape and size here
 * rather than trusted because "the browser produced them".
 */
export function parsePushSubscription(input: unknown): ParsePushSubscriptionResult {
  if (!input || typeof input !== "object") return { ok: false, error: "מנוי לא תקין." };
  const body = input as Record<string, unknown>;

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint || endpoint.length > MAX_ENDPOINT_CHARS) {
    return { ok: false, error: "כתובת המנוי חסרה או ארוכה מדי." };
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, error: "כתובת המנוי אינה כתובת תקינה." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "כתובת המנוי חייבת להיות https." };
  }

  const keys = (body.keys && typeof body.keys === "object" ? body.keys : {}) as Record<
    string,
    unknown
  >;
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  if (!KEY_RE.test(p256dh) || !KEY_RE.test(auth)) {
    return { ok: false, error: "מפתחות ההצפנה של המנוי אינם תקינים." };
  }

  const rawAgent = typeof body.userAgent === "string" ? body.userAgent.trim() : "";
  const userAgent = rawAgent ? rawAgent.slice(0, MAX_USER_AGENT_CHARS) : null;

  return { ok: true, value: { endpoint, p256dh, auth, userAgent } };
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveInternalAccounts, isInternalBusinessId } from "@/lib/internal-accounts";
import { isAdminEmail } from "@/lib/admin";

/**
 * Activation nudge: ONE lifecycle email, ever, for owners who signed up and
 * never produced a document. Pure selection + opt-out token logic, kept free
 * of next/server and Supabase so the unit tests can drive it with plain
 * objects. The cron route (src/app/api/cron/activation-nudge/route.ts) loads
 * the snapshot, calls selectActivationNudges and does the sending.
 *
 * State lives in auth app_metadata (admin-only, unlike user_metadata which
 * the browser can rewrite), as two top-level timestamps:
 *   activation_nudge_d1_at      the email was claimed/sent (key name kept from
 *                               the earlier two-email design, so anyone already
 *                               marked is never emailed again)
 *   activation_nudge_optout_at  the owner clicked the opt-out link
 * GoTrue merges app_metadata on update, so writing one key never clobbers
 * plan_* or provider fields, and writing null removes the key (used to
 * release a claim when the send fails).
 */

export const NUDGE_META = {
  sent: "activation_nudge_d1_at",
  optout: "activation_nudge_optout_at",
} as const;

const HOUR = 60 * 60 * 1000;
/** The email goes out once the account is a day old ... */
export const MIN_AGE_MS = 24 * HOUR;
/** ... and only while it is younger than three days. Older zero-doc accounts
 *  (the backlog that pre-dates this feature) get nothing. */
export const MAX_AGE_MS = 72 * HOUR;

export interface NudgeUser {
  id: string;
  email?: string | null;
  created_at: string;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
  deleted_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
}

export interface NudgeBusiness {
  id: string;
  user_id: string;
}

export interface NudgeCandidate {
  userId: string;
  email: string;
}

/**
 * Who gets the email right now. At most one entry per user, and nobody who
 * already holds the sent marker, so each user gets it at most once ever.
 *
 * Excluded: no or unconfirmed email, banned/deleted, the admin, `.internal`
 * logins, anyone holding ANY internal business (stricter than the metrics'
 * "every" rule: a lifecycle email to one of our own accounts is never
 * wanted), opted out, already sent, or owning a business with any document
 * at all (drafts included: a draft means they found the editor).
 */
export function selectActivationNudges(input: {
  users: ReadonlyArray<NudgeUser>;
  businesses: ReadonlyArray<NudgeBusiness>;
  businessIdsWithDocs: ReadonlySet<string>;
  now: Date;
}): NudgeCandidate[] {
  const now = input.now.getTime();
  const { internalUserIds } = resolveInternalAccounts({
    users: input.users,
    businesses: input.businesses,
  });

  const touchesInternal = new Set<string>();
  const hasDocs = new Set<string>();
  for (const b of input.businesses) {
    if (isInternalBusinessId(b.id)) touchesInternal.add(b.user_id);
    if (input.businessIdsWithDocs.has(b.id)) hasDocs.add(b.user_id);
  }

  const out: NudgeCandidate[] = [];
  const seen = new Set<string>();
  for (const u of input.users) {
    if (seen.has(u.id)) continue;
    const email = (u.email || "").trim();
    if (!email || !u.email_confirmed_at) continue;
    if (u.deleted_at) continue;
    if (u.banned_until && Date.parse(u.banned_until) > now) continue;
    if (isAdminEmail(email)) continue;
    if (internalUserIds.has(u.id) || touchesInternal.has(u.id)) continue;
    if (hasDocs.has(u.id)) continue;

    const meta = u.app_metadata ?? {};
    if (meta[NUDGE_META.optout]) continue;
    if (meta[NUDGE_META.sent]) continue; // one email per user, ever

    const created = Date.parse(u.created_at);
    if (!Number.isFinite(created)) continue;
    const age = now - created;
    if (age < MIN_AGE_MS || age >= MAX_AGE_MS) continue;

    seen.add(u.id);
    out.push({ userId: u.id, email });
  }
  return out;
}

// --- one-click opt-out token -------------------------------------------------

/**
 * HMAC over the user id, keyed by the service-role key (present on every
 * server environment, never shipped to a browser). Domain-separated so the
 * signature is useless for anything but this opt-out. No expiry on purpose:
 * an opt-out link in a months-old email must still work.
 */
function optoutSecret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  return key;
}

export function activationOptoutToken(userId: string, secret: string = optoutSecret()): string {
  return createHmac("sha256", secret)
    .update(`activation-optout:v1:${userId}`)
    .digest("base64url")
    .slice(0, 32);
}

export function verifyActivationOptoutToken(
  userId: string,
  token: string,
  secret: string = optoutSecret(),
): boolean {
  if (typeof token !== "string" || token.length !== 32) return false;
  const expected = Buffer.from(activationOptoutToken(userId, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

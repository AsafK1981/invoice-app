import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveInternalAccounts, isInternalBusinessId } from "@/lib/internal-accounts";
import { isAdminEmail } from "@/lib/admin";

/**
 * Activation nudge: two lifecycle emails for owners who signed up and never
 * produced a document. Pure selection + opt-out token logic, kept free of
 * next/server and Supabase so the unit tests can drive it with plain objects.
 * The cron route (src/app/api/cron/activation-nudge/route.ts) loads the
 * snapshot, calls selectActivationNudges and does the sending.
 *
 * State lives in auth app_metadata (admin-only, unlike user_metadata which
 * the browser can rewrite), as three top-level timestamps:
 *   activation_nudge_d1_at      email #1 claimed/sent
 *   activation_nudge_d2_at      email #2 claimed/sent
 *   activation_nudge_optout_at  the owner clicked the opt-out link
 * GoTrue merges app_metadata on update, so writing one key never clobbers
 * plan_* or provider fields, and writing null removes the key (used to
 * release a claim when the send fails).
 */

export const NUDGE_META = {
  d1: "activation_nudge_d1_at",
  d2: "activation_nudge_d2_at",
  optout: "activation_nudge_optout_at",
} as const;

const HOUR = 60 * 60 * 1000;
/** Email #1 goes out once the account is a day old ... */
export const D1_MIN_AGE_MS = 24 * HOUR;
/** ... and only while it is younger than three days. Older zero-doc accounts
 *  (the backlog that pre-dates this feature) get nothing. */
export const D1_MAX_AGE_MS = 72 * HOUR;
/** Email #2 goes out from day three ... */
export const D2_MIN_AGE_MS = 72 * HOUR;
/** ... and never sooner than this after email #1, so a skipped cron day
 *  cannot put the two emails on consecutive days. */
export const D2_MIN_GAP_MS = 36 * HOUR;

export type NudgeStep = 1 | 2;

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
  step: NudgeStep;
}

function metaTime(meta: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = meta?.[key];
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Who gets which email right now. At most one entry per user, so a single
 * run can never send both emails to the same person.
 *
 * Excluded: no or unconfirmed email, banned/deleted, the admin, `.internal`
 * logins, anyone holding ANY internal business (stricter than the metrics'
 * "every" rule: a lifecycle email to one of our own accounts is never
 * wanted), opted out, or owning a business with any document at all
 * (drafts included: a draft means they found the editor).
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
  for (const u of input.users) {
    const email = (u.email || "").trim();
    if (!email || !u.email_confirmed_at) continue;
    if (u.deleted_at) continue;
    if (u.banned_until && Date.parse(u.banned_until) > now) continue;
    if (isAdminEmail(email)) continue;
    if (internalUserIds.has(u.id) || touchesInternal.has(u.id)) continue;
    if (hasDocs.has(u.id)) continue;

    const meta = u.app_metadata ?? {};
    if (meta[NUDGE_META.optout]) continue;

    const created = Date.parse(u.created_at);
    if (!Number.isFinite(created)) continue;
    const age = now - created;
    if (age < D1_MIN_AGE_MS) continue;

    const d1 = metaTime(meta, NUDGE_META.d1);
    const d2 = metaTime(meta, NUDGE_META.d2);
    if (d2 !== null) continue; // both sent: never again

    if (d1 === null) {
      if (age < D1_MAX_AGE_MS) out.push({ userId: u.id, email, step: 1 });
      continue;
    }
    if (age >= D2_MIN_AGE_MS && now - d1 >= D2_MIN_GAP_MS) {
      out.push({ userId: u.id, email, step: 2 });
    }
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

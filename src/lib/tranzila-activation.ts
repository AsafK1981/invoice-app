import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HostedPaymentResult } from "./tranzila";
import { TRIAL_DAYS, type PlanTier, type BillingInterval } from "./plans";

/**
 * Turning a Tranzila hosted-page result into a subscription (2026-09-23).
 *
 * This module is the WRITER behind /api/tranzila/notify. /api/tranzila/callback
 * - the browser's own return trip - calls none of it and writes nothing.
 *
 * ── Why the result needs authenticating at all ─────────────────────────────
 * DirectNG signs nothing. Both the browser leg (success_url_address) and the
 * server leg (notify_url_address) are unauthenticated URLs that anyone who
 * learns them can POST to. And there is NO transaction-query endpoint in
 * Tranzila's documented API - not in this repo's integration, not in the
 * OpenAPI v1 spec - so "look the transaction up by index and see if it is
 * real" is not something we can implement today, however much we would prefer
 * it.
 *
 * ── What we do instead: a per-checkout single-use nonce ────────────────────
 * /api/billing/checkout mints a 32-byte random nonce, writes a
 * payment_checkout_intents row holding WHO is buying WHAT for HOW MUCH, and
 * hangs the nonce on notify_url_address ONLY. It is deliberately absent from
 * success_url_address: a value on the browser's URL is a value the customer
 * (and anyone they forward the link to) can read, and handing the customer the
 * authenticator for their own payment result defeats the point.
 *
 * On the way back, this module consumes that intent with ONE conditional
 * UPDATE (`... WHERE nonce = $1 AND status = 'pending' RETURNING ...`). In
 * Postgres that statement is atomic, so a replay, a duplicated notify, and a
 * callback/notify race are structurally impossible rather than merely
 * unlikely: the loser gets zero rows back and writes nothing. A read-then-
 * write pair here would be a TOCTOU bug with real money attached, which is why
 * consumeCheckoutIntent() below is one statement and must stay one statement.
 *
 * Identity, tier, interval and the expected amount are then read out of the
 * RETURNED intent row. NOTHING is taken from the POST body except the
 * transaction facts Tranzila alone knows (token, expiry, last 4, indices) and
 * the sum, which is only ever compared against the intent, never trusted.
 *
 * REVISIT IF TRANZILA EVER DOCUMENTS A TRANSACTION-QUERY ENDPOINT: re-verify
 * the transaction server-side by `index` before writing, and make it
 * mandatory. The nonce is a good authenticator for "this result belongs to a
 * checkout we started"; it is not proof that money actually moved. Only the
 * processor can prove that.
 *
 * ── Where the token lives ──────────────────────────────────────────────────
 * subscriptions.provider_token, and nowhere else. NOT app_metadata. The Grow
 * precedent (src/app/api/billing/callback/route.ts, `grow_payment_token`)
 * writes a reusable card token into app_metadata, and app_metadata is readable
 * by the signed-in client - src/app/(app)/billing/page.tsx is a client
 * component that reads it - so that pattern ships a chargeable credential to
 * the browser. subscriptions has RLS on with no policies: service-role only.
 *
 * ── Logging rules (non-negotiable) ─────────────────────────────────────────
 * The token, the card number and the nonce never reach a log line. Last 4
 * digits, response codes, amounts and row ids are fine.
 */

/** Query-string parameter carrying the intent nonce on notify_url_address. */
export const CHECKOUT_NONCE_PARAM = "n";

/**
 * 32 random bytes, base64url. Long enough that guessing one is not a strategy,
 * short enough to sit comfortably in a query string. Never logged.
 */
export function mintCheckoutNonce(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Shape a nonce is allowed to have before it touches a query. Purely a "is
 * this a nonce or is it junk" guard, so a malformed value costs no round trip. */
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

export interface CheckoutIntentRow {
  id: string;
  user_id: string;
  tier: string;
  interval: string;
  expected_amount: number | string;
  token_only: boolean;
}

/** Every way a notify can end. Returned for tests and logs; NEVER returned to
 * the caller over HTTP, because "that nonce was already used" is information
 * an unauthenticated prober should not get. */
export type NotifyOutcome =
  | "ignored-no-nonce"
  | "ignored-malformed-nonce"
  | "ignored-not-approved"
  | "ignored-nonce-not-consumable"
  | "rejected-bad-intent"
  | "rejected-amount-mismatch"
  | "rejected-user-missing"
  | "activated";

export interface NotifyResult {
  outcome: NotifyOutcome;
  /** True only when the plan was actually activated. */
  activated: boolean;
  /** Set when a human needs to look at this. Never contains a secret. */
  alert?: string;
}

/**
 * Consume a pending intent, atomically. Returns the intent when THIS call won
 * the race, null when the nonce is unknown, already consumed or expired -
 * three cases that are deliberately indistinguishable to the caller.
 *
 * ONE statement on purpose. See the module header.
 */
export async function consumeCheckoutIntent(
  admin: SupabaseClient,
  nonce: string,
  txn: { index: string | null; transactionId: string | null },
): Promise<CheckoutIntentRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("payment_checkout_intents")
    .update({
      status: "consumed",
      consumed_at: nowIso,
      transaction_index: txn.index,
      transaction_id: txn.transactionId,
    })
    .eq("nonce", nonce)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .select("id, user_id, tier, interval, expected_amount, token_only")
    .maybeSingle();

  if (error) {
    // Fail closed: an unreadable intent table means we cannot tell a real
    // checkout from a forged POST, so nothing is written. Never echo the nonce.
    console.error("[tranzila-notify] intent consume failed", { message: error.message });
    return null;
  }
  return (data as CheckoutIntentRow | null) ?? null;
}

function normalizeTier(v: string): PlanTier | null {
  return v === "free" || v === "pro" ? v : null;
}
function normalizeInterval(v: string): BillingInterval | null {
  return v === "year" || v === "month" ? v : null;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function addInterval(d: Date, interval: BillingInterval): Date {
  const out = new Date(d);
  if (interval === "year") out.setFullYear(out.getFullYear() + 1);
  else out.setMonth(out.getMonth() + 1);
  return out;
}

/**
 * The whole write path for a verified capture.
 *
 * Order matters and is deliberate:
 *   1. Refuse anything that is not an APPROVED payload BEFORE touching the
 *      intent. A declined attempt must leave the nonce pending, because the
 *      customer may simply retry on the same hosted page; burning the nonce on
 *      a decline would mean their eventual successful payment could never be
 *      recorded.
 *   2. Consume the intent (atomic). From here on, identity and plan come from
 *      the intent row only.
 *   3. Cross-check the echoed sum against the intent's expected_amount. A
 *      mismatch writes NOTHING and alerts - the nonce stays burned, which is
 *      the fail-closed direction.
 *   4. Record the money (subscription_charge_log), then the token
 *      (subscriptions), then the access grant (app_metadata). Each step alerts
 *      loudly on failure; none of them is allowed to un-do a real payment by
 *      denying the customer access they paid for.
 */
export async function activateFromTranzilaNotify(
  admin: SupabaseClient,
  parsed: HostedPaymentResult,
  nonce: string | null,
): Promise<NotifyResult> {
  if (!nonce) {
    // Either a probe, or a notify_url_address that lost its query string.
    console.warn("[tranzila-notify] no intent nonce on the request, ignoring");
    return { outcome: "ignored-no-nonce", activated: false };
  }
  if (!NONCE_RE.test(nonce)) {
    console.warn("[tranzila-notify] nonce is not in the expected format, ignoring");
    return { outcome: "ignored-malformed-nonce", activated: false };
  }

  // ── 1. Only an approved capture may consume an intent ────────────────────
  if (!parsed.approved) {
    console.warn("[tranzila-notify] non-approved result, intent left pending", {
      responseCode: parsed.responseCode,
    });
    return { outcome: "ignored-not-approved", activated: false };
  }

  // ── 2. Atomic single-use consumption ─────────────────────────────────────
  const intent = await consumeCheckoutIntent(admin, nonce, {
    index: parsed.index,
    transactionId: parsed.transactionId,
  });
  if (!intent) {
    // Unknown, already consumed, or expired. Deliberately one message: a
    // prober learns nothing about which.
    console.warn("[tranzila-notify] no pending intent for this result, ignoring");
    return { outcome: "ignored-nonce-not-consumable", activated: false };
  }

  const tier = normalizeTier(intent.tier);
  const interval = normalizeInterval(intent.interval);
  if (!tier || !interval) {
    const alert = `[ALERT] intent ${intent.id} has an unusable tier/interval, nothing written`;
    console.error("[tranzila-notify]", alert);
    return { outcome: "rejected-bad-intent", activated: false, alert };
  }

  // ── 3. The sum must be the sum we asked for ──────────────────────────────
  // numeric(12,2) comes back from PostgREST as a string; compare as money, to
  // the agora, never with ===.
  const expected = Number(intent.expected_amount);
  const received = parsed.sum;
  if (!Number.isFinite(expected) || received == null || Math.abs(received - expected) > 0.005) {
    const alert =
      `[ALERT] amount mismatch on intent ${intent.id}: expected ${expected}, ` +
      `Tranzila reported ${received == null ? "(absent)" : received}. Nothing written.`;
    console.error("[tranzila-notify]", alert);
    return { outcome: "rejected-amount-mismatch", activated: false, alert };
  }

  const { data: found } = await admin.auth.admin.getUserById(intent.user_id);
  if (!found?.user) {
    const alert = `[ALERT] intent ${intent.id} references a user that no longer exists; a real payment may be unattributed`;
    console.error("[tranzila-notify]", alert);
    return { outcome: "rejected-user-missing", activated: false, alert };
  }

  const now = new Date();
  // A token-only checkout (tranmode=N, SHVA "J2 checks card") starts the trial
  // and takes no money. A full-price checkout is a returning subscriber who
  // already used their trial, so the money moved now.
  const isTrialStart = intent.token_only === true;
  const periodEnd = isTrialStart ? addDays(now, TRIAL_DAYS) : addInterval(now, interval);
  const periodEndIso = periodEnd.toISOString();
  const nowIso = now.toISOString();

  let alert: string | undefined;

  // ── 4a. Record the money ─────────────────────────────────────────────────
  // KNOWN RESIDUAL RISK, documented rather than solved (council, 2026-09-23):
  // this row is written AFTER the money moved, and DirectNG takes no
  // idempotency key from us, so a crash or timeout between the capture and
  // this insert leaves a real charge with no local record. The partial UNIQUE
  // index on (provider, transaction_id) added by
  // scripts/migrations/20260923-tranzila-token-persistence.sql closes the
  // other direction only: the same transaction can never be credited twice.
  // Reconciling the missing direction needs a report pulled from my.tranzila,
  // not more code here.
  if (!isTrialStart) {
    const { error: logErr } = await admin.from("subscription_charge_log").insert({
      user_id: intent.user_id,
      period_start: nowIso.slice(0, 10),
      amount: expected,
      provider: "tranzila",
      transaction_id: parsed.transactionId || parsed.index || null,
      success: true,
    });
    if (logErr && !/duplicate|unique|23505/i.test(logErr.message)) {
      alert = `[ALERT] charge-log insert failed for a real Tranzila capture (intent ${intent.id}): ${logErr.message}`;
      console.error("[tranzila-notify]", alert);
    }
  }

  // ── 4b. The token, in the one place it is allowed to live ────────────────
  if (!parsed.token) {
    // An approved capture with no token means the terminal is not tokenizing.
    // The money (if any) still moved, so we activate; the cron will treat the
    // tokenless row as a data gap and skip it loudly instead of dunning.
    const tokenAlert = `[ALERT] approved Tranzila capture with NO token (intent ${intent.id}); this subscription cannot be renewed automatically`;
    console.error("[tranzila-notify]", tokenAlert);
    alert = alert ? `${alert} | ${tokenAlert}` : tokenAlert;
  } else if (parsed.expireMonth == null || parsed.expireYear == null) {
    const expAlert = `[ALERT] Tranzila capture without an expiry (intent ${intent.id}); a token with no expiry cannot be charged`;
    console.error("[tranzila-notify]", expAlert);
    alert = alert ? `${alert} | ${expAlert}` : expAlert;
  }

  const { data: biz } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", intent.user_id)
    .limit(1)
    .maybeSingle();

  const { error: subErr } = await admin.from("subscriptions").upsert(
    {
      user_id: intent.user_id,
      business_id: (biz as { id?: string } | null)?.id || null,
      tier,
      interval,
      provider: "tranzila",
      provider_token: parsed.token,
      card_exp_month: parsed.expireMonth,
      card_exp_year: parsed.expireYear,
      card_last4: parsed.last4,
      provider_terminal: parsed.terminal,
      current_period_end: periodEndIso.slice(0, 10),
      status: "active",
      cancel_at_period_end: false,
      retry_count: 0,
      first_failed_at: null,
      updated_at: nowIso,
    },
    { onConflict: "user_id" },
  );
  if (subErr) {
    // Alert, but do NOT refuse the activation below: the customer paid, and
    // withholding access they paid for is the worse failure. What this costs us
    // is the next charge, which is exactly why it alerts.
    const subAlert = `[ALERT] subscriptions upsert failed after a real capture (intent ${intent.id}): ${subErr.message}. This subscription will never auto-renew.`;
    console.error("[tranzila-notify]", subAlert);
    alert = alert ? `${alert} | ${subAlert}` : subAlert;
  }

  // ── 4c. The access grant. Plan fields only - NO TOKEN. ───────────────────
  // Re-fetch right before writing (the guard the callback/invite routes use)
  // so a concurrent metadata write is not clobbered.
  const { data: latest } = await admin.auth.admin.getUserById(intent.user_id);
  const prevAppMeta = ((latest?.user ?? found.user).app_metadata || {}) as Record<string, unknown>;
  await admin.auth.admin.updateUserById(intent.user_id, {
    app_metadata: {
      ...prevAppMeta,
      plan_tier: tier,
      plan_active: true,
      plan_trialing: isTrialStart,
      plan_trial_used: true,
      plan_cancel_at_period_end: false,
      plan_current_period_end: periodEndIso,
      plan_beta_grant: false,
      payment_provider: "tranzila",
      // Tranzila has no subscription object; the capture's transaction id is
      // the closest stable handle back to my.tranzila.
      provider_subscription_id: parsed.transactionId || parsed.index || null,
      // NOTHING resembling a card token goes in here. See the module header.
    },
  });

  return { outcome: "activated", activated: true, alert };
}

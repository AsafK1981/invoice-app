import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { cronAuthError, cronAdminClient } from "@/lib/cron";
import { chargeToken, getPlanPrice, isGrowConfigured } from "@/lib/grow";
import { calculateNextDue } from "@/lib/recurring-store";
import { issueSelfInvoice } from "@/lib/documents-server";
import { getPlan, type PlanTier, type BillingInterval } from "@/lib/plans";
import { CANONICAL_ORIGIN } from "@/lib/public-url";

/**
 * Recurring subscription-billing + dunning cron (Grow / Meshulam).
 *
 * Runs daily (vercel.json → "0 7 * * *"). ONE route owns both renewal and the
 * failed-charge dunning escalation, per the plan (squishy-knitting-valiant.md
 * §3-4). Structure below:
 *
 *   A. Auth (cronAuthError) + load due rows from the `subscriptions` work-queue.
 *   B. Per row:
 *      1. Idempotency recovery: if this period is already logged as charged
 *         (a crash between charge-log and period-advance), just advance & reset.
 *      2. past_due gating: only retry on day 1 / 3 / 5 relative to first_failed_at.
 *      3. Charge the saved Grow token via chargeToken().
 *      4. On SUCCESS: write charge log (idempotency marker), advance
 *         current_period_end via calculateNextDue(), re-fetch-before-write the
 *         user's app_metadata, reset the subscription row, issue a self-invoice.
 *      5. On FAILURE: do NOT advance the period, do NOT write a success log
 *         (so the next run retries), increment retry_count, set past_due /
 *         first_failed_at. On the final (day-5) failure: downgrade
 *         (app_metadata.plan_active=false, status=canceled) + Hebrew email.
 *
 * app_metadata.plan_* stays the enforcement source of truth; this table is a
 * scheduler index only.
 */

/**
 * This cron only has a job to do when Grow is the live processor. Production
 * currently runs Polar (PAYMENT_PROVIDER unset or "polar"), where renewals are
 * Polar's business and this route must not touch anyone's subscription. Mirror
 * of the gating in the billing routes.
 */
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER === "grow" ? "grow" : "polar";

const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";
const SAAS_VENDOR_BUSINESS_ID = process.env.SAAS_VENDOR_BUSINESS_ID || "";
const APP_URL = CANONICAL_ORIGIN;

// Dunning escalation days relative to first_failed_at. Retry #1 fires on day 1,
// #2 on day 3, #3 (FINAL) on day 5. The initial charge failure is day 0 and sets
// retry_count = 1, so retry_count is the 1-based index of the NEXT scheduled
// retry (retry_count=1 → RETRY_DAYS[0], etc). Mirrors dunning/run's day buckets.
const RETRY_DAYS = [1, 3, 5] as const;

interface SubscriptionRow {
  id: string;
  user_id: string;
  business_id: string | null;
  tier: string;
  interval: string;
  provider: string;
  provider_token: string | null;
  current_period_end: string; // "YYYY-MM-DD"
  status: "active" | "past_due" | "canceled";
  retry_count: number;
  first_failed_at: string | null;
  last_charge_at: string | null;
}

/** Whole calendar days between a timestamp/date and today, UTC (same math as
 * dunning/run's daysSince, tolerant of both "YYYY-MM-DD" and full ISO input). */
function daysSince(dateStr: string): number {
  const datePart = dateStr.slice(0, 10);
  const [y, m, d] = datePart.split("-").map(Number);
  const thenUTC = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((todayUTC - thenUTC) / 86400000);
}

function todayIso10(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
}

/**
 * Fail-closed: an unrecognized tier/interval returns null and the row is
 * SKIPPED, never guessed. These values decide how much money to take off a
 * saved card; defaulting a corrupt row to "pro"/"month" would charge the
 * customer the wrong amount on an unattended cron, which needs a refund to
 * undo. Skipping leaves the row due so it can be inspected and re-run.
 */
function normalizeTier(v: string): PlanTier | null {
  return v === "free" || v === "pro" ? v : null;
}
function normalizeInterval(v: string): BillingInterval | null {
  return v === "year" || v === "month" ? v : null;
}

export async function GET(req: Request) {
  const unauth = cronAuthError(req);
  if (unauth) return unauth;

  // ── HARD ABORT before any work is selected ────────────────────────────────
  // Two ways this route could do damage while Grow is not actually live:
  //   1. PAYMENT_PROVIDER != "grow": Polar owns renewals; charging here would
  //      double-bill or fight Polar's webhook over the same app_metadata.
  //   2. Grow credentials missing: chargeToken() throws, and the catch around
  //      it (deliberately, for transient network errors) coerces the throw into
  //      success=false, i.e. a CARD DECLINE. That feeds the dunning ladder and
  //      auto-downgrades paying customers over a config gap they cannot fix.
  // So we bail out here, BEFORE the `subscriptions` query, with a 200 so the
  // Vercel cron doesn't alarm on a state that is entirely expected.
  if (PAYMENT_PROVIDER !== "grow" || !isGrowConfigured()) {
    return NextResponse.json({ ok: true, skipped: "grow not configured" });
  }

  const admin = cronAdminClient();
  const today = todayIso10();

  // ── A. Load due rows: active OR past_due whose period boundary has arrived ──
  const { data: rows, error } = await admin
    .from("subscriptions")
    .select(
      "id, user_id, business_id, tier, interval, provider, provider_token, current_period_end, status, retry_count, first_failed_at, last_charge_at",
    )
    .in("status", ["active", "past_due"])
    .lte("current_period_end", today);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, due: 0, charged: 0, skipped: 0 });
  }

  let charged = 0;
  let skipped = 0;
  let failed = 0;
  let downgraded = 0;
  const details: Array<{ user: string; outcome: string }> = [];

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
  });

  for (const row of rows as SubscriptionRow[]) {
    const userId = row.user_id;
    const tier = normalizeTier(row.tier);
    const interval = normalizeInterval(row.interval);
    if (!tier || !interval) {
      skipped++;
      details.push({
        user: userId,
        outcome: `SKIPPED: unrecognized tier/interval (${row.tier}/${row.interval}), needs manual review`,
      });
      continue;
    }
    // period_start = the boundary date being renewed = the current_period_end
    // that triggered this charge. Stable across retries → idempotency key.
    const periodStart = row.current_period_end.slice(0, 10);

    // ── B1. Idempotency recovery ──────────────────────────────────────────────
    // If a successful charge for this exact period is already logged (a crash
    // between the charge-log write and the period advance), don't charge again,
    // just finish the advancement so the row leaves the due window.
    const { data: existingLog } = await admin
      .from("subscription_charge_log")
      .select("id, success")
      .eq("user_id", userId)
      .eq("period_start", periodStart)
      .eq("success", true)
      .maybeSingle();

    if (existingLog) {
      await advancePeriod(admin, row, tier, interval, periodStart);
      skipped++;
      details.push({ user: userId, outcome: "already-charged (recovered advance)" });
      continue;
    }

    // ── B2. past_due day-bucket gating ────────────────────────────────────────
    // Only retry on the scheduled escalation days; don't hammer a declined card
    // every single day. retry_count is the 1-based index of the next retry.
    if (row.status === "past_due" && row.first_failed_at) {
      const daysF = daysSince(row.first_failed_at);
      const bucketIdx = row.retry_count - 1; // 0-based index into RETRY_DAYS
      if (bucketIdx >= RETRY_DAYS.length) {
        // Exhausted but somehow still selected: safety downgrade.
        await downgrade(admin, row);
        downgraded++;
        details.push({ user: userId, outcome: "exhausted retries → downgraded" });
        continue;
      }
      if (daysF < RETRY_DAYS[bucketIdx]) {
        skipped++;
        details.push({ user: userId, outcome: `waiting (day ${daysF}/${RETRY_DAYS[bucketIdx]})` });
        continue;
      }
    }

    // ── B3. Charge the saved token ────────────────────────────────────────────
    // A missing token is OUR data gap (the provider callback never returned one),
    // not a declined card. Do NOT run it through dunning; that would email the
    // subscriber "payment failed" and downgrade them after 5 days for something
    // they can't fix. Skip it and surface it for manual attention instead.
    if (!row.provider_token) {
      skipped++;
      details.push({ user: userId, outcome: "SKIPPED: no provider token (data gap, needs manual review)" });
      console.error("[subscription-billing] subscription has no provider_token, cannot charge", {
        userId,
        subscriptionId: row.id,
      });
      continue;
    }

    const amount = getPlanPrice(tier, interval);
    const planName = getPlan(tier).name;
    const description = `מנוי ${planName}: חיוב ${interval === "year" ? "שנתי" : "חודשי"}`;

    let success = false;
    let transactionId: string | undefined;
    try {
      const res = await chargeToken({
        token: row.provider_token,
        sum: amount,
        description,
      });
      success = res.success;
      transactionId = res.transactionId;
    } catch (err) {
      // Network/transport error talking to Grow; treat as a transient failure.
      console.warn("[subscription-billing] chargeToken threw", err);
      success = false;
    }

    if (!success) {
      const wasFinal = await recordFailure(admin, transporter, row, tier, interval);
      failed++;
      if (wasFinal) downgraded++;
      details.push({ user: userId, outcome: wasFinal ? "final failure → downgraded" : "charge failed" });
      continue;
    }

    // ── B4. SUCCESS ───────────────────────────────────────────────────────────
    // Write the idempotency marker FIRST (right after the money moved), then
    // advance the period + reset the row + metadata, then the self-invoice.
    // A UNIQUE(user_id, period_start) conflict here means a concurrent run
    // already charged; treat as done and still finish the advancement.
    const { error: logErr } = await admin.from("subscription_charge_log").insert({
      user_id: userId,
      period_start: periodStart,
      amount,
      provider: row.provider || "grow",
      transaction_id: transactionId || null,
      success: true,
    });
    if (logErr && !/duplicate|unique|23505/i.test(logErr.message)) {
      // Unexpected log-write failure. The charge already went through, so DON'T
      // re-charge; log and move on. The period stays un-advanced, but the
      // recovery branch (B1) will pick it up next run once the log exists; here
      // it didn't get written, so as a fallback we still advance now.
      console.warn("[subscription-billing] charge-log insert failed", logErr);
    }

    await advancePeriod(admin, row, tier, interval, periodStart);

    // ── Self-invoice (NON-FATAL): the charge already succeeded ─────────────────
    if (SAAS_VENDOR_BUSINESS_ID) {
      try {
        const clientName = await subscriberName(admin, userId);
        const inv = await issueSelfInvoice({
          businessId: SAAS_VENDOR_BUSINESS_ID,
          clientName,
          amount,
          description,
        });
        // Best-effort link the receipt to the charge-log row.
        await admin
          .from("subscription_charge_log")
          .update({ document_id: inv.documentId })
          .eq("user_id", userId)
          .eq("period_start", periodStart);
      } catch (err) {
        console.warn("[subscription-billing] self-invoice failed (non-fatal)", err);
      }
    } else {
      console.warn("[subscription-billing] SAAS_VENDOR_BUSINESS_ID unset, skipping self-invoice");
    }

    charged++;
    details.push({ user: userId, outcome: `charged ₪${amount}` });
  }

  return NextResponse.json({
    ok: true,
    due: rows.length,
    charged,
    failed,
    downgraded,
    skipped,
    details: details.slice(0, 100),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type Admin = ReturnType<typeof cronAdminClient>;
type Transporter = ReturnType<typeof nodemailer.createTransport>;

/**
 * Advance the subscription to its next period and re-activate it. Re-fetches the
 * user's app_metadata right before writing (same guard as the callback /
 * invite-redeem routes) so we don't clobber a concurrent metadata write.
 */
async function advancePeriod(
  admin: Admin,
  row: SubscriptionRow,
  tier: PlanTier,
  interval: BillingInterval,
  periodStart: string,
): Promise<void> {
  // calculateNextDue expects "monthly" | "weekly" | "yearly". Subscription
  // intervals are "month" | "year" (BillingInterval), so map accordingly. We
  // advance FROM the period boundary that triggered the charge (periodStart), not
  // from today, so periods never drift even if the cron runs a day or two late.
  const newPeriodEnd = calculateNextDue(
    periodStart,
    interval === "year" ? "yearly" : "monthly",
  );
  const newPeriodEndIso = new Date(`${newPeriodEnd}T00:00:00.000Z`).toISOString();
  const nowIso = new Date().toISOString();

  // Re-fetch-before-write the user's app_metadata.
  const { data: latest } = await admin.auth.admin.getUserById(row.user_id);
  const prevMeta = (latest?.user?.app_metadata || {}) as Record<string, unknown>;
  await admin.auth.admin.updateUserById(row.user_id, {
    app_metadata: {
      ...prevMeta,
      plan_tier: tier,
      plan_active: true,
      plan_trialing: false,
      plan_current_period_end: newPeriodEndIso,
    },
  });

  await admin
    .from("subscriptions")
    .update({
      current_period_end: newPeriodEnd,
      status: "active",
      retry_count: 0,
      first_failed_at: null,
      last_charge_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", row.id);
}

/**
 * Record a failed charge. Increments retry_count, flips to past_due, stamps
 * first_failed_at once. Deliberately does NOT advance the period and does NOT
 * write a success charge-log row; so the next run retries (mirrors the dunning
 * route's "no log row on failure" rule). Returns true if this was the FINAL
 * (day-5) attempt, in which case it also downgrades + emails.
 */
async function recordFailure(
  admin: Admin,
  transporter: Transporter,
  row: SubscriptionRow,
  tier: PlanTier,
  interval: BillingInterval,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const wasActive = row.status !== "past_due";
  // The attempt we JUST made maps to a RETRY_DAYS bucket index:
  //   - initial charge on the due date (was active): index -1 (the "day 0"
  //     charge, before any scheduled retry) → never final.
  //   - a past_due retry: index = row.retry_count - 1 (retry_count is 1-based).
  const currentBucketIdx = wasActive ? -1 : row.retry_count - 1;
  // FINAL when the attempt we just made was the LAST scheduled retry (day 5).
  const isFinal = currentBucketIdx >= RETRY_DAYS.length - 1;
  // retry_count after this attempt. Active→first failure makes it 1.
  const nextRetry = wasActive ? 1 : row.retry_count + 1;

  if (isFinal) {
    await downgrade(admin, row);
    await sendFailureEmail(admin, transporter, row, tier, interval).catch((err) =>
      console.warn("[subscription-billing] failure email error", err),
    );
    return true;
  }

  await admin
    .from("subscriptions")
    .update({
      status: "past_due",
      retry_count: nextRetry,
      first_failed_at: row.first_failed_at || nowIso,
      updated_at: nowIso,
    })
    .eq("id", row.id);
  return false;
}

/**
 * Final downgrade: cancel the subscription and pull Pro access. Re-fetches
 * app_metadata before writing plan_active=false so we don't clobber concurrent
 * writes.
 */
async function downgrade(admin: Admin, row: SubscriptionRow): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: latest } = await admin.auth.admin.getUserById(row.user_id);
  const prevMeta = (latest?.user?.app_metadata || {}) as Record<string, unknown>;
  await admin.auth.admin.updateUserById(row.user_id, {
    app_metadata: {
      ...prevMeta,
      plan_active: false,
      plan_trialing: false,
    },
  });
  await admin
    .from("subscriptions")
    .update({ status: "canceled", updated_at: nowIso })
    .eq("id", row.id);
}

/** Best-effort display name for the subscriber (for the self-invoice client). */
async function subscriberName(admin: Admin, userId: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId);
  const user = data?.user;
  const meta = (user?.user_metadata || {}) as Record<string, unknown>;
  return (
    (meta.full_name as string) ||
    (meta.name as string) ||
    user?.email ||
    "מנוי"
  );
}

/** Look up the subscriber's email for the dunning-failure notice. */
async function subscriberEmail(admin: Admin, userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email || null;
}

/**
 * Hebrew "payment failed, please resubscribe" email, sent once on the final
 * (day-5) failed charge. Same nodemailer transporter/RTL template style as the
 * dunning route.
 */
async function sendFailureEmail(
  admin: Admin,
  transporter: Transporter,
  row: SubscriptionRow,
  tier: PlanTier,
  interval: BillingInterval,
): Promise<void> {
  const to = await subscriberEmail(admin, row.user_id);
  if (!to) return;

  const planName = getPlan(tier).name;
  const amount = getPlanPrice(tier, interval);
  const billingUrl = `${APP_URL}/billing`;
  const subject = "התשלום לא עבר, המנוי הושהה";

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,sans-serif;">
  <div dir="rtl" style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#f97316,#e11d48);padding:24px;border-radius:16px;color:white;text-align:center;margin-bottom:24px;">
      <h1 style="margin:0;font-size:22px;">My Super Friendly Invoice App</h1>
    </div>
    <div style="background:#fffaf5;border:1px solid #fed7aa;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 12px 0;font-size:16px;color:#44403c;">שלום,</p>
      <p style="margin:0 0 16px 0;font-size:15px;color:#44403c;line-height:1.6;">ניסינו לחייב את הכרטיס עבור מנוי ${planName} (₪${amount}) מספר פעמים ולא הצלחנו. המנוי הושהה כרגע.</p>
      <p style="margin:0 0 12px 0;font-size:14px;color:#44403c;line-height:1.6;">כדי לחדש את הגישה המלאה, אפשר להתחבר ולהזין אמצעי תשלום מעודכן.</p>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${billingUrl}" style="display:inline-block;background:linear-gradient(135deg,#f97316,#e11d48);color:white;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:bold;">חידוש המנוי ←</a>
    </div>
    <p style="font-size:11px;color:#a8a29e;text-align:center;">הודעה אוטומטית. אם כבר טיפלת בזה, אפשר להתעלם.</p>
  </div>
</body>
</html>`;

  const text = `שלום,

ניסינו לחייב את הכרטיס עבור מנוי ${planName} (₪${amount}) מספר פעמים ולא הצלחנו. המנוי הושהה.

לחידוש המנוי:
${billingUrl}

הודעה אוטומטית. אם כבר טיפלת בזה, אפשר להתעלם.`;

  await transporter.sendMail({
    from: `"My Super Friendly Invoice App" <${GMAIL_USER}>`,
    to,
    subject,
    html,
    text,
    headers: {
      "X-Auto-Response-Suppress": "All",
      "Auto-Submitted": "auto-generated",
    },
  });
}

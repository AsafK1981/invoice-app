import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  GROW_CALLBACK_SECRET,
  approveTransaction,
  getPlanPrice,
  TOKEN_VALIDATION_AMOUNT,
} from "@/lib/grow";
import { TRIAL_DAYS, type PlanTier, type BillingInterval } from "@/lib/plans";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Which processor is live. Defaults to "polar", which is what production runs
 * today: the Polar webhook route keeps handling everything and THIS route
 * no-ops, so the two providers never fight over the same user's app_metadata.
 * Grow only takes over on an explicit PAYMENT_PROVIDER=grow. Mirror of the
 * gating in checkout/route.ts.
 */
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER === "grow" ? "grow" : "polar";

/**
 * Grow (by Meshulam) server-to-server payment callback, the Grow equivalent of
 * the old Polar webhook (src/app/api/billing/webhook/route.ts). Grow POSTs a
 * FORM-ENCODED (not JSON) body here after a hosted-page charge.
 *
 * ── Trust model (Grow does NOT sign callbacks) ────────────────────────────
 * There is no HMAC / signature header. Our layered defense:
 *   1. PRIMARY GATE: the ?cs=<GROW_CALLBACK_SECRET> query param we wired into
 *      the callback URL in checkout/route.ts must match. 401 otherwise.
 *   2. customFields must carry a supabase_user_id that resolves to a real user.
 *   3. The echoed `sum` must match either the expected plan price for the
 *      (tier, interval) OR the ₪1 token-validation amount; else we log and
 *      ignore (a spoofer who somehow learned the secret still can't invent a
 *      sane price/tier combination for an arbitrary user).
 *   4. Best-effort approveTransaction() as acknowledgment, NOT a gate (Grow
 *      processes the txn regardless), so we never block on it.
 */
export async function POST(req: NextRequest) {
  try {
    // ── Provider gate: while Polar is live (the default), this route is inert ─
    // The Polar webhook route handles that provider independently; we no-op so
    // the two never race on the same app_metadata.
    if (PAYMENT_PROVIDER === "polar") {
      return NextResponse.json({ received: true, skipped: true });
    }

    // ── 1. PRIMARY trust gate: our own shared secret in the query string ────
    // Grow signs nothing, so this is the first (and cheapest) line of defense.
    const cs = req.nextUrl.searchParams.get("cs");
    if (!GROW_CALLBACK_SECRET || !cs || cs !== GROW_CALLBACK_SECRET) {
      console.warn("[grow-callback] secret mismatch or missing");
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ── 2. Parse the FORM-ENCODED body into the documented fields ──────────
    // Grow posts application/x-www-form-urlencoded. formData() handles both
    // urlencoded and multipart, so it's the most defensive choice.
    const form = await req.formData();
    const field = (k: string): string => {
      const v = form.get(k);
      return typeof v === "string" ? v : "";
    };

    const cb = {
      asmachta: field("asmachta"),
      transactionId: field("transactionId"),
      transactionToken: field("transactionToken"),
      cardSuffix: field("cardSuffix"),
      cardType: field("cardType"),
      cardBrand: field("cardBrand"),
      cardExp: field("cardExp"),
      status: field("status"),
      statusCode: field("statusCode"),
      sum: field("sum"),
      paymentDate: field("paymentDate"),
      fullName: field("fullName"),
      payerPhone: field("payerPhone"),
      payerEmail: field("payerEmail"),
      processId: field("processId"),
      processToken: field("processToken"),
      customFields: field("customFields"),
    };

    // ── 3. Extract customFields defensively ─────────────────────────────────
    // The wire format Grow uses to echo customFields back was NOT confirmed.
    // The checkout route SENT them as cField1="supabase_user_id=<id>",
    // cField2="tier=<tier>", cField3="interval=<interval>" (Meshulam-family
    // convention). So Grow might return them as:
    //   (a) a single JSON string in `customFields`, or
    //   (b) individual top-level cField1/cField2/cField3 keys ("key=value"), or
    //   (c) a `key=value&key=value` string in `customFields`.
    // We try all three.
    // TODO(verify against Grow's live docs / confirm during sandbox testing):
    // pin down the ACTUAL customFields return format from a real callback and
    // drop the branches that don't apply.
    const parsedCustom = parseCustomFields(cb.customFields, form);
    const supabaseUserId = parsedCustom.supabase_user_id;
    // tier/interval are OUR OWN values round-tripping back through Grow, so an
    // unrecognized one means the round-trip broke; never a user choice we can
    // infer. Both FAIL CLOSED (null) rather than defaulting, because the sum
    // check below cannot catch a wrong tier on the trial path: every trial
    // start is a TOKEN_VALIDATION_AMOUNT charge, so ₪1 === ₪1 validates for
    // ANY tier. A default of "pro" here would silently hand out the paid plan
    // whenever customFields arrive missing or corrupt.
    const tier = normalizeTier(parsedCustom.tier);
    const interval = normalizeInterval(parsedCustom.interval);

    if (!supabaseUserId) {
      console.warn("[grow-callback] no supabase_user_id in customFields", {
        customFields: cb.customFields,
      });
      return NextResponse.json(
        { ok: false, error: "Missing user reference" },
        { status: 400 },
      );
    }

    if (!tier || !interval) {
      console.warn("[grow-callback] unparseable tier/interval in customFields", {
        customFields: cb.customFields,
        rawTier: parsedCustom.tier,
        rawInterval: parsedCustom.interval,
      });
      return NextResponse.json(
        { ok: false, error: "Missing plan reference" },
        { status: 400 },
      );
    }

    // ── 4. Determine success ────────────────────────────────────────────────
    // Mirror the defensive success heuristic used by chargeToken() in grow.ts:
    // statusCode "1" (or status "1") counts as success. We ALSO require a real
    // transaction identifier (transactionId or asmachta) so an empty/forged
    // "success" with no transaction can't activate a plan.
    const statusOk = cb.statusCode === "1" || cb.status === "1";
    const hasTxn = !!cb.transactionId || !!cb.asmachta;
    if (!statusOk || !hasTxn) {
      console.warn("[grow-callback] non-success or missing txn, ignoring", {
        statusCode: cb.statusCode,
        status: cb.status,
        transactionId: cb.transactionId,
        asmachta: cb.asmachta,
      });
      // Not an error on our side; acknowledge so Grow doesn't hammer retries.
      return NextResponse.json({ received: true, activated: false });
    }

    // ── 5. Cross-check the echoed sum against what we expect ────────────────
    // Accept EITHER the real plan price for (tier, interval) OR the ₪1
    // token-validation amount the checkout route uses to start a trial. This is
    // trust anchor #3: even someone who learned the secret can't invent a sane
    // (sum, tier, interval) triple for an arbitrary user.
    const receivedSum = Number(cb.sum);
    const expectedPrice = getPlanPrice(tier, interval);
    const isTokenValidationCharge =
      Number.isFinite(receivedSum) && receivedSum === TOKEN_VALIDATION_AMOUNT;
    const isFullPriceCharge =
      Number.isFinite(receivedSum) && receivedSum === expectedPrice;

    if (!isTokenValidationCharge && !isFullPriceCharge) {
      console.warn("[grow-callback] sum mismatch, ignoring", {
        receivedSum: cb.sum,
        expectedPrice,
        tokenValidationAmount: TOKEN_VALIDATION_AMOUNT,
        tier,
        interval,
      });
      return NextResponse.json(
        { ok: false, error: "Amount mismatch" },
        { status: 400 },
      );
    }

    // A ₪1 token-validation charge means this is a trial START (no full payment
    // yet; the real charge fires later via the recurring cron). A full-price
    // charge means an immediate paid activation (returning subscriber who
    // already used their trial).
    const isTrialStart = isTokenValidationCharge;
    console.log("[grow-callback] charge case", {
      isTrialStart,
      receivedSum: cb.sum,
      expectedPrice,
      tier,
      interval,
    });

    // ── 6. Best-effort approveTransaction (acknowledgment, NOT a gate) ──────
    // Grow processes the transaction whether or not this succeeds, so we never
    // block the activation on it. Log failures and continue.
    try {
      await approveTransaction({
        processId: cb.processId,
        processToken: cb.processToken,
        transactionId: cb.transactionId,
        transactionToken: cb.transactionToken,
        sum: cb.sum,
        asmachta: cb.asmachta,
      });
    } catch (err) {
      console.warn("[grow-callback] approveTransaction failed (non-fatal)", err);
    }

    // ── 7. Resolve the Supabase user (service-role admin client) ────────────
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: found } = await admin.auth.admin.getUserById(supabaseUserId);
    if (!found?.user) {
      console.warn("[grow-callback] user not found", { supabaseUserId });
      return NextResponse.json(
        { ok: false, error: "User not found" },
        { status: 404 },
      );
    }

    // ── 8. Re-fetch RIGHT before writing to avoid clobbering concurrent ─────
    // writes (same guard as invite/redeem/route.ts). The gap between the lookup
    // above and the write below is small but a concurrent write could land in
    // it; re-reading keeps us on the freshest app_metadata.
    // If the re-fetch transiently fails, fall back to the user we already
    // verified above; never build the write on an empty metadata base.
    const { data: latest } = await admin.auth.admin.getUserById(supabaseUserId);
    const freshestUser = latest?.user ?? found.user;
    const prevAppMeta = (freshestUser.app_metadata || {}) as Record<string, unknown>;

    // Period end: for a trial start it's now + TRIAL_DAYS. For an immediate paid
    // charge it's now + 1 month or 1 year per interval.
    // NOTE: a NOT-YET-BUILT recurring-billing cron
    // (src/app/api/cron/subscription-billing/route.ts, separate task) will be the
    // long-term source of period advancement; this initial value just covers the
    // first period until that cron takes over.
    const periodEndIso = isTrialStart
      ? addDays(new Date(), TRIAL_DAYS).toISOString()
      : addInterval(new Date(), interval).toISOString();

    // The token the recurring-billing cron feeds to chargeToken(). Grow should
    // always echo it, but if a callback arrives without one we must NOT write an
    // empty value: that would overwrite a working token from an earlier callback
    // and silently make the subscription uncharageable. Keep whatever we already
    // had, and flag the gap so the cron and any audit can see it rather than
    // discovering it at the first failed renewal.
    const paymentToken =
      cb.transactionToken || (prevAppMeta.grow_payment_token as string | undefined);
    if (!paymentToken) {
      console.error("[grow-callback] no transactionToken, recurring charges will fail", {
        supabaseUserId,
        transactionId: cb.transactionId,
        processId: cb.processId,
      });
    }

    await admin.auth.admin.updateUserById(supabaseUserId, {
      app_metadata: {
        ...prevAppMeta,
        plan_tier: tier,
        plan_active: true,
        plan_trialing: isTrialStart,
        plan_trial_used: true,
        plan_cancel_at_period_end: false,
        plan_current_period_end: periodEndIso,
        plan_beta_grant: false, // they're paying now; no longer a beta grant
        payment_provider: "grow",
        // processId is the closest thing Grow has to a stable, subscription-like
        // handle across the token's lifetime (transactionId is per-charge), so we
        // use it as the "subscription" id.
        provider_subscription_id: cb.processId || cb.transactionId,
        // processToken best identifies the payment "process"/customer session on
        // Grow's side; fall back to any previously stored customer id.
        provider_customer_id:
          cb.processToken ||
          (prevAppMeta.provider_customer_id as string | undefined),
        // THE value the future recurring-charge cron will feed to chargeToken().
        // If it's empty (provider returned no token, logged above), the cron
        // reads the same empty token from the subscriptions row and skips the
        // charge as a data gap instead of dunning the subscriber.
        grow_payment_token: paymentToken,
      },
    });

    // ── 9. Upsert the subscriptions work-queue row ──────────────────────────
    // app_metadata (written above) stays the enforcement source of truth. This
    // row is the scheduler index the recurring-billing cron
    // (/api/cron/subscription-billing) queries to know who/when to charge. Small
    // additive write; never let it break the (already-successful) activation.
    try {
      const { data: biz } = await admin
        .from("businesses")
        .select("id")
        .eq("user_id", supabaseUserId)
        .limit(1)
        .maybeSingle();

      await admin.from("subscriptions").upsert(
        {
          user_id: supabaseUserId,
          business_id: biz?.id || null,
          tier,
          interval,
          provider: "grow",
          // MUST be `paymentToken` (which falls back to the previously stored
          // token), NOT the raw cb.transactionToken. This row is what the
          // recurring cron reads; writing null here on a callback that happens
          // to omit the token would strand a subscriber whose token is still
          // perfectly good in app_metadata: the cron would read null, treat it
          // as a data gap, and silently stop charging them forever.
          provider_token: paymentToken || null,
          // Cron charges the token when current_period_end <= today. For a trial
          // start that's the trial-end date, so the first real charge fires then.
          current_period_end: periodEndIso.slice(0, 10),
          status: "active",
          retry_count: 0,
          first_failed_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    } catch (subErr) {
      console.warn("[grow-callback] subscriptions upsert failed (non-fatal)", subErr);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Grow callback handler error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Defensive customFields decoder. Handles the three plausible return shapes
 * (see the block-comment at the call site). Returns a flat map of the passthrough
 * keys we sent (supabase_user_id / tier / interval).
 */
function parseCustomFields(
  customFields: string,
  form: FormData,
): Record<string, string> {
  const out: Record<string, string> = {};

  const absorbKeyValue = (s: string) => {
    // "key=value": split on the FIRST "=" only (values could contain "=").
    const eq = s.indexOf("=");
    if (eq > 0) {
      const k = s.slice(0, eq).trim();
      const v = s.slice(eq + 1).trim();
      if (k) out[k] = v;
    }
  };

  // (a) Single JSON string in `customFields`.
  if (customFields) {
    try {
      const j = JSON.parse(customFields) as unknown;
      if (j && typeof j === "object" && !Array.isArray(j)) {
        for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
          if (typeof v === "string") out[k] = v;
          else if (v != null) out[k] = String(v);
        }
      }
    } catch {
      // (c) Not JSON: maybe "key=value&key=value" or a single "key=value".
      if (customFields.includes("&")) {
        for (const part of customFields.split("&")) absorbKeyValue(part);
      } else {
        absorbKeyValue(customFields);
      }
    }
  }

  // (b) Individual top-level cField1/cField2/... keys, each "key=value" (the
  // exact format the checkout route SENT). Probe a generous range.
  for (let i = 1; i <= 10; i += 1) {
    const raw = form.get(`cField${i}`);
    if (typeof raw === "string" && raw) absorbKeyValue(raw);
  }

  return out;
}

/**
 * Both return null on anything unrecognized; deliberately fail-closed. See the
 * call site: the sum cross-check is tier-blind on the ₪1 trial path, so a
 * guessed tier would be unguarded. Caller rejects the callback with a 400.
 */
function normalizeTier(v: string | undefined): PlanTier | null {
  return v === "free" || v === "pro" ? v : null;
}

function normalizeInterval(v: string | undefined): BillingInterval | null {
  return v === "year" || v === "month" ? v : null;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Adds one billing interval (1 month or 1 year) to a date. Simple calendar math
 * (setMonth/setFullYear); good enough for the first period until the recurring
 * cron (not yet built) owns period advancement via calculateNextDue().
 */
function addInterval(d: Date, interval: BillingInterval): Date {
  const out = new Date(d);
  if (interval === "year") out.setFullYear(out.getFullYear() + 1);
  else out.setMonth(out.getMonth() + 1);
  return out;
}

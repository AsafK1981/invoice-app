import { NextRequest, NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { polar, getProductId } from "@/lib/polar";
import {
  isGrowConfigured,
  createPaymentProcess,
  getPlanPrice,
  GROW_CALLBACK_SECRET,
  TOKEN_VALIDATION_AMOUNT,
} from "@/lib/grow";
import {
  isTranzilaConfigured,
  buildHostedPaymentUrl,
  getPlanPrice as getTranzilaPlanPrice,
  TOKEN_VALIDATION_AMOUNT as TRANZILA_TOKEN_VALIDATION_AMOUNT,
} from "@/lib/tranzila";
import { TRIAL_DAYS, type PlanTier, type BillingInterval } from "@/lib/plans";
import { CANONICAL_ORIGIN } from "@/lib/public-url";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Which processor backs new checkouts. Defaults to "polar", the provider that
 * is actually live today. Both the Grow and Tranzila branches below ship
 * complete but INERT: they only run once PAYMENT_PROVIDER is explicitly set,
 * which happens after real credentials exist and the flow has been verified
 * end to end. Defaulting to either before then would break every real
 * checkout on the first deploy. Grow is superseded (Asaf dropped it
 * 2026-07-24) but left wired for reference; Tranzila is the live candidate
 * as of 2026-07-31 (see docs/payments/tranzila-integration.md).
 */
const PAYMENT_PROVIDER =
  process.env.PAYMENT_PROVIDER === "grow"
    ? "grow"
    : process.env.PAYMENT_PROVIDER === "tranzila"
      ? "tranzila"
      : "polar";

// Keeps the NEXT_PUBLIC_APP_URL override (payment providers validate return
// URLs against what was registered with them), falling back to the canonical
// origin rather than a second copy of the domain literal.
const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || CANONICAL_ORIGIN;

/**
 * Resolve the origin used to build the browser-facing success/cancel URLs.
 *
 * The `Origin` request header is CLIENT CONTROLLED. A browser sets it and JS
 * cannot forge it, but this is a server route: anyone can send an arbitrary
 * Origin with curl. Interpolating it straight into successUrl would let a
 * caller mint a payment link that bounces the payer to a domain they own after
 * the charge, which is a ready-made phishing flow wearing our checkout.
 *
 * So the header is an ALLOWLIST LOOKUP, never a value we pass through. Anything
 * unrecognized silently falls back to our own origin. The allowlist exists only
 * so a preview deployment returns to itself instead of jumping to production
 * mid-flow; it is not an extension point for arbitrary domains.
 */
const ALLOWED_ORIGINS = new Set(
  [APP_ORIGIN, CANONICAL_ORIGIN].filter(Boolean) as string[],
);

function resolveOrigin(req: NextRequest): string {
  const header = req.headers.get("origin");
  return header && ALLOWED_ORIGINS.has(header) ? header : APP_ORIGIN;
}

/**
 * Creates a checkout session for a subscription. Body shape:
 *   { tier: "free" | "pro", interval: "month" | "year" }
 * Response (unchanged contract the frontend relies on):
 *   { ok: true, url }  |  { ok: false, error }
 *
 * "free" is the internal tier ID for the Basic display tier, kept for
 * backwards compat with existing user_metadata.plan_tier values.
 *
 * Routed by PAYMENT_PROVIDER between Polar (default, live) and Grow (opt-in,
 * PAYMENT_PROVIDER=grow).
 */
export async function POST(req: NextRequest) {
  try {
    // ── Auth (identical to the original Polar route) ──────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice(7);

    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ── Resolve tier/interval defensively (identical logic) ───────────────
    const body = (await req.json().catch(() => ({}))) as {
      tier?: PlanTier;
      interval?: BillingInterval;
    };
    const tier: PlanTier = body.tier === "free" || body.tier === "pro" ? body.tier : "pro";
    const interval: BillingInterval =
      body.interval === "year" || body.interval === "month" ? body.interval : "month";

    const origin = resolveOrigin(req);

    if (PAYMENT_PROVIDER === "polar") {
      return await handlePolarCheckout({ user, tier, interval, origin });
    }
    if (PAYMENT_PROVIDER === "tranzila") {
      return await handleTranzilaCheckout({ user, tier, interval, origin });
    }
    return await handleGrowCheckout({ user, tier, interval, origin });
  } catch (err) {
    console.error("Checkout error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Grow (opt-in, only reached when PAYMENT_PROVIDER=grow)
// ─────────────────────────────────────────────────────────────────────────
async function handleGrowCheckout({
  user,
  tier,
  interval,
  origin,
}: {
  user: User;
  tier: PlanTier;
  interval: BillingInterval;
  origin: string;
}) {
  if (!isGrowConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Grow not configured" },
      { status: 503 },
    );
  }

  // First-time subscribers get a trial; returning subscribers (canceled then
  // resubscribed) don't, so they can't farm the trial by churning. Read from
  // app_metadata (the trustworthy source), user_metadata as pre-migration
  // fallback, same logic as the original Polar route.
  const hasUsedTrial =
    ((user.app_metadata || {}) as Record<string, unknown>).plan_trial_used === true ||
    ((user.user_metadata || {}) as Record<string, unknown>).plan_trial_used === true;

  const fullPrice = getPlanPrice(tier, interval);

  // ── Charge amount for THIS checkout ──────────────────────────────────────
  // For a first-time trial we do NOT charge the full price now. We only want a
  // saved card token; the first real charge fires later via the recurring cron
  // (not built in this task).
  //
  // We send TOKEN_VALIDATION_AMOUNT (₪1) as that validation amount; defined
  // once in grow.ts and shared with the callback route, which accepts the same
  // amount as a valid sum.
  //
  // TODO(verify against Grow's live docs / support): true ₪0 tokenization. Card
  //   networks generally reject a ₪0 authorization, so many processors require a
  //   nominal ≥₪1 validation charge even just to save a token. IF Grow supports a
  //   genuine 0-charge tokenization mode, switch to that instead (it directly
  //   affects trial UX; the user shouldn't be charged during a "free" trial).
  //   This is the single most important billing detail to confirm before shipping.
  const isTrial = !hasUsedTrial;
  const chargeSum = isTrial ? TOKEN_VALIDATION_AMOUNT : fullPrice;

  // Browser-facing redirects: NO secret here (users see these URLs).
  const successUrl = `${origin}/billing?success=1`;
  const cancelUrl = `${origin}/billing?canceled=1`;

  // Server-to-server callback URL: THIS is where our anti-spoof secret goes.
  // Grow doesn't sign callbacks, so ?cs=<secret> stops randos from POSTing junk
  // to our callback. NOTE: whether Grow's model uses a dedicated server-callback
  // field or reuses successUrl is unconfirmed; see the TODO in grow.ts's
  // createPaymentProcess. We pass a dedicated callback URL and let grow.ts send
  // it under its best-guess field name (`notifyUrl`).
  // TODO(verify against Grow's live docs): confirm the server-callback wiring.
  // No secret-less fallback: isGrowConfigured() above already refused the whole
  // request with a 503 when GROW_CALLBACK_SECRET is unset, precisely so we never
  // charge a card for a subscription whose callback the callback route will then
  // reject as unsigned.
  const callbackUrl = `${APP_ORIGIN}/api/billing/callback?cs=${encodeURIComponent(GROW_CALLBACK_SECRET)}`;

  const { raw, url } = await createPaymentProcess({
    sum: chargeSum,
    description: `${tier === "pro" ? "Pro" : "Basic"} ${interval === "year" ? "yearly" : "monthly"}`,
    successUrl,
    cancelUrl,
    // Grow rejects special characters in parameter values; user.email/name can
    // legitimately contain "@" and dots. We only pass email/phone/name into
    // pageField[*] which is where Grow expects contact info; keep it simple.
    fullName: (user.user_metadata?.full_name as string | undefined) || user.email || "Customer",
    phone: (user.user_metadata?.phone as string | undefined) || "",
    email: user.email || "",
    // Passthrough echoed back on the callback, mirrors the flat `metadata`
    // shape the old Polar checkout used, so the callback can map back to a user.
    customFields: { supabase_user_id: user.id, tier, interval },
    // Save a reusable token for the recurring cron to charge later.
    saveToken: true,
    callbackUrl,
  });

  // Best-effort: stash a Grow customer/process hint into app_metadata (service
  // role only), mirroring how the Polar route stored polar_customer_id. We do
  // NOT set plan_active / plan_tier here; that only happens once the callback
  // route confirms the real payment. Nor do we set plan_current_period_end here;
  // the callback owns the trial period end (now + TRIAL_DAYS) once it fires.
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const parsed = raw.parsed;
    const customerId =
      typeof parsed === "object" && parsed !== null
        ? (typeof parsed.processId === "string"
            ? parsed.processId
            : typeof parsed.customerId === "string"
              ? parsed.customerId
              : undefined)
        : undefined;
    const prevAppMeta = (user.app_metadata || {}) as Record<string, unknown>;
    if (customerId && prevAppMeta.provider_customer_id !== customerId) {
      await admin.auth.admin.updateUserById(user.id, {
        app_metadata: {
          ...prevAppMeta,
          provider_customer_id: customerId,
          payment_provider: "grow",
        },
      });
    }
  } catch {
    // non-fatal: customer ID will be persisted on the callback instead
  }

  // The 14-day trial (TRIAL_DAYS) is intentionally NOT applied here; that is
  // the callback route's job. This route's scope is: get a token + redirect URL.
  void TRIAL_DAYS;

  return NextResponse.json({ ok: true, url });
}

// ─────────────────────────────────────────────────────────────────────────
// Tranzila (opt-in, only reached when PAYMENT_PROVIDER=tranzila)
//
// NOT a tested integration — see docs/payments/tranzila-integration.md.
// Simpler shape than the Grow branch above: token capture happens entirely
// on Tranzila's own hosted page (no server-side create-session call from us
// first), so this handler only builds the redirect URL.
// ─────────────────────────────────────────────────────────────────────────
async function handleTranzilaCheckout({
  user,
  tier,
  interval,
  origin,
}: {
  user: User;
  tier: PlanTier;
  interval: BillingInterval;
  origin: string;
}) {
  if (!isTranzilaConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Tranzila not configured" },
      { status: 503 },
    );
  }

  const hasUsedTrial =
    ((user.app_metadata || {}) as Record<string, unknown>).plan_trial_used === true ||
    ((user.user_metadata || {}) as Record<string, unknown>).plan_trial_used === true;

  const isTrial = !hasUsedTrial;
  const chargeSum = isTrial
    ? TRANZILA_TOKEN_VALIDATION_AMOUNT
    : getTranzilaPlanPrice(tier, interval);

  const successUrl = `${origin}/billing?success=1`;
  const failUrl = `${origin}/billing?canceled=1`;

  const url = buildHostedPaymentUrl({
    sum: chargeSum,
    successUrl,
    failUrl,
    fullName: (user.user_metadata?.full_name as string | undefined) || user.email || "Customer",
    email: user.email || "",
    phone: (user.user_metadata?.phone as string | undefined) || "",
    // Uses tranmode=N (SHVA J2 "checks card") instead of a standard debit —
    // see the tranmode comment in tranzila.ts's buildHostedPaymentUrl(): the
    // card is verified but not actually charged for a first-time trial.
    tokenOnly: isTrial,
  });

  // The 30-day trial (TRIAL_DAYS) and the actual plan activation both happen
  // once the token comes back from the hosted page — NOT built yet (see
  // docs/payments/tranzila-integration.md item 4). This route's scope ends at
  // "build the redirect URL."
  void TRIAL_DAYS;

  return NextResponse.json({ ok: true, url });
}

// ─────────────────────────────────────────────────────────────────────────
// Polar (the live default; Grow/Tranzila only take over on an explicit
// PAYMENT_PROVIDER)
// ─────────────────────────────────────────────────────────────────────────
async function handlePolarCheckout({
  user,
  tier,
  interval,
  origin,
}: {
  user: User;
  tier: PlanTier;
  interval: BillingInterval;
  origin: string;
}) {
  if (!polar) {
    return NextResponse.json(
      { ok: false, error: "Polar not configured" },
      { status: 503 },
    );
  }

  const productId = getProductId(tier, interval);
  if (!productId) {
    return NextResponse.json(
      { ok: false, error: `מחיר ל-${tier}/${interval} לא הוגדר` },
      { status: 503 },
    );
  }

  const hasUsedTrial =
    ((user.app_metadata || {}) as Record<string, unknown>).plan_trial_used === true ||
    ((user.user_metadata || {}) as Record<string, unknown>).plan_trial_used === true;

  const checkout = await polar.checkouts.create({
    products: [productId],
    customerEmail: user.email,
    externalCustomerId: user.id,
    successUrl: `${origin}/billing?success=1`,
    metadata: {
      supabase_user_id: user.id,
      tier,
      interval,
    },
    allowDiscountCodes: true,
    ...(hasUsedTrial
      ? { allowTrial: false as const }
      : {
          allowTrial: true as const,
          trialInterval: "day" as const,
          trialIntervalCount: TRIAL_DAYS,
        }),
  });

  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const customerId =
      typeof checkout.customerId === "string" ? checkout.customerId : undefined;
    const prevAppMeta = (user.app_metadata || {}) as Record<string, unknown>;
    if (customerId && prevAppMeta.polar_customer_id !== customerId) {
      await admin.auth.admin.updateUserById(user.id, {
        app_metadata: { ...prevAppMeta, polar_customer_id: customerId },
      });
    }
  } catch {
    // non-fatal: customer ID will be persisted on the next webhook
  }

  return NextResponse.json({ ok: true, url: checkout.url });
}

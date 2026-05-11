import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { polar, getProductId } from "@/lib/polar";
import { TRIAL_DAYS, type PlanTier, type BillingInterval } from "@/lib/plans";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Creates a Polar checkout session for a subscription. Body shape:
 *   { tier: "free" | "pro", interval: "month" | "year" }
 *
 * "free" is the internal tier ID for the Basic display tier — kept for
 * backwards compat with existing user_metadata.plan_tier values.
 *
 * The user's Supabase ID is passed as `customerExternalId` so the webhook
 * can map subscription events back to a Supabase user without an extra
 * lookup. We also stash the same ID in metadata as a belt-and-suspenders.
 */
export async function POST(req: NextRequest) {
  if (!polar) {
    return NextResponse.json(
      { ok: false, error: "Polar not configured" },
      { status: 503 },
    );
  }

  try {
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

    const body = (await req.json().catch(() => ({}))) as {
      tier?: PlanTier;
      interval?: BillingInterval;
    };
    const tier: PlanTier = body.tier === "free" || body.tier === "pro" ? body.tier : "pro";
    const interval: BillingInterval =
      body.interval === "year" || body.interval === "month" ? body.interval : "month";

    const productId = getProductId(tier, interval);
    if (!productId) {
      return NextResponse.json(
        { ok: false, error: `מחיר ל-${tier}/${interval} לא הוגדר` },
        { status: 503 },
      );
    }

    const origin = req.headers.get("origin") || "https://mysuperfriendlyinvoiceapp.vercel.app";

    // First-time subscribers get a 14-day trial; returning subscribers
    // (canceled then resubscribed) don't, so they can't farm the trial
    // by churning. Read from app_metadata (the trustworthy source).
    const hasUsedTrial =
      ((user.app_metadata || {}) as Record<string, unknown>).plan_trial_used === true ||
      // Fallback for any pre-migration users (the migration should have
      // moved this already, but defense in depth).
      ((user.user_metadata || {}) as Record<string, unknown>).plan_trial_used === true;

    const checkout = await polar.checkouts.create({
      products: [productId],
      customerEmail: user.email,
      // Maps Supabase user.id to a Polar customer. If the customer
      // doesn't exist yet, Polar creates one with this external ID
      // attached so future webhooks can resolve back without a lookup.
      externalCustomerId: user.id,
      successUrl: `${origin}/billing?success=1`,
      // Polar's metadata only accepts flat scalar values.
      metadata: {
        supabase_user_id: user.id,
        tier,
        interval,
      },
      allowDiscountCodes: true,
      // 14-day trial for first-time subscribers. Polar honors trial
      // settings on the checkout level when allowTrial is true.
      ...(hasUsedTrial
        ? { allowTrial: false as const }
        : {
            allowTrial: true as const,
            trialInterval: "day" as const,
            trialIntervalCount: TRIAL_DAYS,
          }),
    });

    // Best-effort: store the Polar customer hint on the Supabase user
    // (in app_metadata, which is service-role only) so the customer
    // portal route can resolve it without a round-trip.
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
      // non-fatal — customer ID will be persisted on the next webhook
    }

    return NextResponse.json({ ok: true, url: checkout.url });
  } catch (err) {
    console.error("Checkout error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

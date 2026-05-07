import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stripe, getPriceId } from "@/lib/stripe";
import { TRIAL_DAYS, type PlanTier, type BillingInterval } from "@/lib/plans";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Creates a Stripe Checkout session for a subscription. Body shape:
 *   { tier: "free" | "pro", interval: "month" | "year" }
 *
 * "free" is the internal name for the Basic tier (₪19/mo) — kept for
 * backwards compatibility with existing user_metadata. New customers
 * get a 14-day trial (no card required up-front).
 */
export async function POST(req: NextRequest) {
  if (!stripe) {
    return NextResponse.json(
      { ok: false, error: "Stripe not configured" },
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

    const priceId = getPriceId(tier, interval);
    if (!priceId) {
      return NextResponse.json(
        { ok: false, error: `מחיר ל-${tier}/${interval} לא הוגדר` },
        { status: 503 },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Find or create Stripe customer
    let customerId = user.user_metadata?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, stripe_customer_id: customerId },
      });
    }

    const origin = req.headers.get("origin") || "https://mysuperfriendlyinvoiceapp.vercel.app";

    // Only first-time subscribers get a trial. Returning customers
    // (canceled then resubscribed) don't, so they can't farm the trial.
    const hasUsedTrial = user.user_metadata?.plan_trial_used === true;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/billing?success=1`,
      cancel_url: `${origin}/billing?canceled=1`,
      allow_promotion_codes: true,
      metadata: { supabase_user_id: user.id, tier, interval },
      subscription_data: {
        metadata: { supabase_user_id: user.id, tier, interval },
        ...(hasUsedTrial ? {} : { trial_period_days: TRIAL_DAYS }),
      },
      // No card required during the free trial — they can add one later
      // via the customer portal. After the trial Stripe will pause the
      // sub if there's still no payment method.
      ...(hasUsedTrial
        ? {}
        : { payment_method_collection: "if_required" as const }),
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

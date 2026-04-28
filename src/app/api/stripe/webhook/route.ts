import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

export async function POST(req: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ ok: false, error: "Stripe not configured" }, { status: 503 });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature || !webhookSecret) {
    return NextResponse.json(
      { ok: false, error: "Missing signature or secret" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  async function updateUserPlanFromSubscription(sub: Stripe.Subscription) {
    const userId = sub.metadata?.supabase_user_id;
    if (!userId) {
      console.warn("Subscription has no supabase_user_id metadata", sub.id);
      return;
    }

    const status = sub.status;
    const isActive = status === "active" || status === "trialing";
    const periodEndUnix = (sub as unknown as { current_period_end?: number }).current_period_end;

    const { data: { user } } = await admin.auth.admin.getUserById(userId);
    if (!user) return;

    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...user.user_metadata,
        plan_tier: isActive ? "pro" : "free",
        plan_active: isActive,
        plan_cancel_at_period_end: sub.cancel_at_period_end,
        plan_current_period_end: periodEndUnix
          ? new Date(periodEndUnix * 1000).toISOString()
          : null,
        stripe_subscription_id: sub.id,
        stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      },
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await updateUserPlanFromSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await updateUserPlanFromSubscription(sub);
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

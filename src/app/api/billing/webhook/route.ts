import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { findTierByProductId } from "@/lib/polar";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const webhookSecret = process.env.POLAR_WEBHOOK_SECRET || "";

/**
 * Polar webhook handler. Mirrors the previous Stripe webhook semantics,
 * each subscription event resolves which tier the user is now on (by
 * looking up the product ID) and writes plan_tier + plan_active into
 * Supabase user_metadata.
 *
 * Supabase user ID rides in via the subscription's `customerExternalId`
 * (set during checkout) so we can find the right user without an extra
 * email lookup.
 */
export async function POST(req: NextRequest) {
  if (!webhookSecret) {
    return NextResponse.json(
      { ok: false, error: "Webhook secret not configured" },
      { status: 503 },
    );
  }

  const body = await req.text();
  // Polar's webhook lib expects headers as a plain object.
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });

  let event;
  try {
    event = validateEvent(body, headers, webhookSecret);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
    }
    throw err;
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Helper: write subscription state into user_metadata. Polar's subscription
  // shape is: { id, status, customerId, customer, productId, recurringInterval,
  // currentPeriodEnd, cancelAtPeriodEnd, ... }
  async function applySubscription(sub: {
    id: string;
    status: string;
    customerId?: string;
    customer?: { externalId?: string | null; id?: string };
    productId?: string;
    currentPeriodEnd?: string | Date | null;
    cancelAtPeriodEnd?: boolean;
    metadata?: Record<string, unknown>;
  }) {
    const externalId =
      sub.customer?.externalId ||
      (typeof sub.metadata?.supabase_user_id === "string"
        ? sub.metadata.supabase_user_id
        : null);
    if (!externalId) {
      console.warn("Subscription has no externalId", sub.id);
      return;
    }

    const status = sub.status;
    const isActive = status === "active" || status === "trialing";
    const isTrialing = status === "trialing";

    const lookup = sub.productId ? findTierByProductId(sub.productId) : null;
    const paidTier = lookup?.tier ?? (sub.metadata?.tier as "free" | "pro" | undefined) ?? "pro";

    const { data: { user } } = await admin.auth.admin.getUserById(externalId);
    if (!user) return;

    const periodEndIso = sub.currentPeriodEnd
      ? new Date(sub.currentPeriodEnd).toISOString()
      : null;

    // Write to app_metadata: only the service role can touch this. The
    // user CANNOT modify it from a browser console (which would let
    // them grant themselves Pro for free if we stored plan fields in
    // user_metadata).
    const prevAppMeta = (user.app_metadata || {}) as Record<string, unknown>;
    await admin.auth.admin.updateUserById(externalId, {
      app_metadata: {
        ...prevAppMeta,
        plan_tier: isActive ? paidTier : "free",
        plan_active: isActive,
        plan_trialing: isTrialing,
        plan_trial_used: prevAppMeta.plan_trial_used === true || isActive,
        plan_cancel_at_period_end: sub.cancelAtPeriodEnd === true,
        plan_current_period_end: periodEndIso,
        plan_beta_grant: false, // they're paying now; no longer a beta grant
        polar_subscription_id: sub.id,
        polar_customer_id:
          sub.customerId ||
          sub.customer?.id ||
          (prevAppMeta.polar_customer_id as string | undefined),
      },
    });
  }

  try {
    // Polar event types: subscription.created, subscription.updated,
    // subscription.canceled, subscription.active, subscription.revoked,
    // order.paid, etc. We handle the subscription lifecycle here.
    switch (event.type) {
      case "subscription.created":
      case "subscription.updated":
      case "subscription.active":
      case "subscription.canceled":
      case "subscription.revoked": {
        // event.data shape matches the helper's expected sub object.
        await applySubscription(event.data as Parameters<typeof applySubscription>[0]);
        break;
      }
      default:
        // Ignore everything else (order.created, etc.); we only care
        // about subscription state.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Polar webhook handler error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

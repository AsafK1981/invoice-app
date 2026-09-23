import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Which processor is live. Defaults to "polar", which is what production runs
 * today. Under Polar, subscription management (cancel/resume) goes through
 * Polar's hosted customer portal (src/app/api/billing/portal), so THIS route
 * refuses until someone opts in with PAYMENT_PROVIDER=grow or =tranzila.
 * Mirror of the gating in checkout/route.ts and callback/route.ts.
 */
const PAYMENT_PROVIDER =
  process.env.PAYMENT_PROVIDER === "grow"
    ? "grow"
    : process.env.PAYMENT_PROVIDER === "tranzila"
      ? "tranzila"
      : "polar";

/**
 * Providers whose subscription lifecycle WE manage (no hosted customer
 * portal). A subscription recorded under any of these can be cancelled here,
 * whichever one happens to be live right now: refusing to cancel a Grow-era
 * subscription because the env has since moved to Tranzila would leave a
 * customer with no way to stop being charged, and stopping a charge is never
 * the dangerous direction.
 */
const SELF_MANAGED = new Set(["grow", "tranzila"]);

/**
 * Cancel (or resume) the calling user's self-managed subscription. Body:
 *   { action: "cancel" | "resume" }
 *
 * Neither Grow nor Tranzila has a hosted customer portal (unlike Polar), so we
 * manage the subscription's lifecycle ourselves.
 *
 * "cancel" does NOT immediately revoke access: the user keeps Pro until
 * plan_current_period_end, and the recurring-billing cron stops charging at
 * that boundary. This matches how Polar's cancelAtPeriodEnd behaved. "resume"
 * un-does a pending cancellation before the period ends.
 *
 * ── The write goes to TWO places, and that is the whole point (2026-09-23) ──
 * Until today this route only set app_metadata.plan_cancel_at_period_end, and
 * the comment below claimed "the recurring-billing cron reads this flag to
 * stop charging at the period boundary". NOTHING READ IT. Under any
 * self-managed provider a cancelled subscriber would have kept being charged
 * forever. So now:
 *   1. subscriptions.cancel_at_period_end - the scheduler row the cron selects
 *      anyway, so the stop costs it no extra read.
 *   2. app_metadata.plan_cancel_at_period_end - what the UI shows, and the
 *      cron's belt-and-braces second check for a user whose queue row is
 *      missing or stale.
 * Either one alone stops the charge; both are written so neither a missing row
 * nor a stale metadata copy can quietly re-start billing.
 *
 * Auth: Bearer Supabase token → auth.getUser (same pattern as checkout/route.ts).
 * Just before writing we re-fetch the user (service-role) so a concurrent
 * callback write isn't silently clobbered; the invite/redeem guard pattern.
 */
export async function POST(req: NextRequest) {
  try {
    // ── Provider gate: while Polar is live (the default), cancellation goes ──
    // through Polar's hosted customer portal, not here. Refuse clearly so the
    // client can fall back to the portal-redirect path.
    if (PAYMENT_PROVIDER === "polar") {
      return NextResponse.json(
        {
          ok: false,
          error: "Use the Polar customer portal while PAYMENT_PROVIDER=polar",
        },
        { status: 410 },
      );
    }

    // ── Auth (identical to checkout/route.ts) ──────────────────────────────
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

    // ── Resolve action strictly: anything but the two known values is a bad
    // request; never default a malformed body into a cancellation.
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "cancel" && body.action !== "resume") {
      return NextResponse.json(
        { ok: false, error: 'action must be "cancel" or "resume"' },
        { status: 400 },
      );
    }
    const action: "cancel" | "resume" = body.action;

    // ── Re-fetch the user RIGHT before writing (invite/redeem guard) ────────
    // A concurrent callback write (e.g. checkout completing in another tab)
    // could otherwise be silently clobbered.
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: latest } = await admin.auth.admin.getUserById(user.id);
    if (!latest?.user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }
    const prevAppMeta = (latest.user.app_metadata || {}) as Record<string, unknown>;

    // ── Confirm this is a self-managed, active subscription ────────────────
    const subscriptionProvider =
      typeof prevAppMeta.payment_provider === "string" ? prevAppMeta.payment_provider : "";
    if (!SELF_MANAGED.has(subscriptionProvider)) {
      return NextResponse.json(
        { ok: false, error: "אין מנוי פעיל לניהול" },
        { status: 409 },
      );
    }
    if (prevAppMeta.plan_active !== true) {
      return NextResponse.json(
        { ok: false, error: "אין מנוי פעיל לביטול" },
        { status: 409 },
      );
    }

    // ── Write the pending-cancellation flag ────────────────────────────────
    // Does NOT immediately revoke access: plan_active stays true and
    // plan_current_period_end is untouched, so getPlanStatus keeps granting
    // Pro until the period ends.
    const cancelAtPeriodEnd = action === "cancel";

    // 1. The scheduler row FIRST. It is the copy that actually stops the
    //    money: /api/cron/subscription-billing refuses to charge a row with
    //    cancel_at_period_end = true and closes the subscription at the
    //    boundary instead. Writing it before the metadata means a failure
    //    between the two leaves the charge stopped and the UI stale, not the
    //    other way round.
    const { error: queueError } = await admin
      .from("subscriptions")
      .update({
        cancel_at_period_end: cancelAtPeriodEnd,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
    if (queueError) {
      // Fail closed: never tell someone "cancelled" when the thing that
      // charges their card has not been told. They can retry.
      console.error("[billing-cancel] subscriptions update failed", queueError.message);
      return NextResponse.json(
        { ok: false, error: "לא הצלחנו לעדכן את המנוי, אפשר לנסות שוב" },
        { status: 500 },
      );
    }

    // 2. app_metadata: what the billing UI reads, and the cron's second check.
    await admin.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...prevAppMeta,
        plan_cancel_at_period_end: cancelAtPeriodEnd,
      },
    });

    return NextResponse.json({ ok: true, cancelAtPeriodEnd });
  } catch (err) {
    console.error("Cancel error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Which processor is live. Defaults to "polar", which is what production runs
 * today. Under Polar, subscription management (cancel/resume) goes through
 * Polar's hosted customer portal (src/app/api/billing/portal), so THIS route
 * refuses until someone opts in with PAYMENT_PROVIDER=grow. Mirror of the
 * gating in checkout/route.ts and callback/route.ts.
 */
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER === "grow" ? "grow" : "polar";

/**
 * Cancel (or resume) the calling user's Grow subscription. Body:
 *   { action: "cancel" | "resume" }
 *
 * Grow has no hosted customer portal (unlike Polar), so we manage the
 * subscription's lifecycle ourselves by writing to app_metadata; the same
 * secure write target the callback/webhook/invite-redeem routes use.
 *
 * "cancel" does NOT immediately revoke access. It sets
 * plan_cancel_at_period_end=true; the user keeps Pro until
 * plan_current_period_end, and the recurring-billing cron (separate task)
 * stops charging them at that point. This matches how Polar's
 * cancelAtPeriodEnd behaved. "resume" un-does a pending cancellation before
 * the period ends.
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

    // ── Confirm this is a Grow-backed, active subscription ─────────────────
    if (prevAppMeta.payment_provider !== "grow") {
      return NextResponse.json(
        { ok: false, error: "אין מנוי Grow פעיל לניהול" },
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
    // Pro until the period ends. The recurring-billing cron reads this flag to
    // stop charging at the period boundary.
    const cancelAtPeriodEnd = action === "cancel";
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

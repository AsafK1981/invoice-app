import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRate, clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Redeem a beta invite code. Body: { code: string }
 *
 * Behavior:
 *   1. Auth user must be logged in (Bearer token).
 *   2. Code must exist, be active, not expired, and have available slots.
 *   3. User can't redeem the same code twice.
 *   4. If user already has an active *paid* subscription (Polar), refuse —
 *      no point granting a beta on top.
 *   5. On success: bump redemptions_count, insert redemption row, set
 *      user_metadata.plan_tier / plan_active / plan_beta_grant / plan_current_period_end.
 *
 * Rate limit: 10 attempts per minute per IP — slows brute force guessing
 * of unknown codes.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = checkRate({ key: `invite-redeem:${ip}`, max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "ניסיונות רבים מדי. נסה שוב בעוד דקה." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
    );
  }

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

  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = body.code?.trim().toUpperCase();
  if (!code || !/^[A-Z0-9-]{4,32}$/.test(code)) {
    return NextResponse.json({ ok: false, error: "קוד לא תקין" }, { status: 400 });
  }

  // Refuse if user already has a paid Polar subscription — we don't want
  // to overwrite their real sub state with beta-grant fields. Read from
  // app_metadata (service-role-only) since that's where the webhook
  // writes plan state.
  const appMeta = (user.app_metadata || {}) as Record<string, unknown>;
  const userMeta = (user.user_metadata || {}) as Record<string, unknown>;
  // Look in app_metadata first, fall back to user_metadata for legacy users.
  const planActive =
    appMeta.plan_active === true ||
    (appMeta.plan_active === undefined && userMeta.plan_active === true);
  const polarSubId =
    (appMeta.polar_subscription_id as string | undefined) ||
    (userMeta.polar_subscription_id as string | undefined);
  const isBetaGrant =
    appMeta.plan_beta_grant === true ||
    (appMeta.plan_beta_grant === undefined && userMeta.plan_beta_grant === true);
  if (polarSubId && planActive && !isBetaGrant) {
    return NextResponse.json(
      { ok: false, error: "כבר יש לך מנוי פעיל בתשלום — לא ניתן להמיר אותו לבטא." },
      { status: 409 },
    );
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: invite, error: lookupError } = await sb
    .from("beta_invites")
    .select("*")
    .eq("code", code)
    .single();

  if (lookupError || !invite) {
    return NextResponse.json({ ok: false, error: "קוד לא קיים או שגוי" }, { status: 404 });
  }

  if (!invite.active) {
    return NextResponse.json({ ok: false, error: "הקוד הושבת" }, { status: 410 });
  }

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: "הקוד פג תוקף" }, { status: 410 });
  }

  if (invite.redemptions_count >= invite.max_redemptions) {
    return NextResponse.json(
      { ok: false, error: "הקוד נוצל במלואו" },
      { status: 410 },
    );
  }

  // Check if this user already redeemed this code (different path than the
  // UNIQUE constraint — we want a clean error message, not a DB violation).
  const { data: existing } = await sb
    .from("beta_invite_redemptions")
    .select("id, expires_at")
    .eq("invite_id", invite.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { ok: false, error: "כבר השתמשת בקוד הזה", alreadyExpiresAt: existing.expires_at },
      { status: 409 },
    );
  }

  const expiresAt = new Date(Date.now() + invite.days_granted * 24 * 60 * 60 * 1000);

  // Insert the redemption row. If two requests race, the UNIQUE
  // (invite_id, user_id) constraint will fail the second one — we
  // catch and return 409.
  const { error: redeemError } = await sb.from("beta_invite_redemptions").insert({
    invite_id: invite.id,
    user_id: user.id,
    expires_at: expiresAt.toISOString(),
  });

  if (redeemError) {
    if (redeemError.code === "23505") {
      return NextResponse.json({ ok: false, error: "כבר השתמשת בקוד הזה" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: redeemError.message }, { status: 500 });
  }

  // Atomically bump the counter. If this races past max_redemptions we
  // accept the slight over-redemption rather than failing — at small
  // scale (≤1000 invites) it's not worth a full transaction.
  await sb
    .from("beta_invites")
    .update({ redemptions_count: invite.redemptions_count + 1 })
    .eq("id", invite.id);

  // Stamp the grant on app_metadata (admin-only). The Polar webhook will
  // overwrite these if the user later subscribes for real.
  await sb.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...appMeta,
      plan_tier: invite.plan_tier,
      plan_active: true,
      plan_beta_grant: true,
      plan_invite_code: invite.code,
      plan_current_period_end: expiresAt.toISOString(),
    },
  });

  return NextResponse.json({
    ok: true,
    plan_tier: invite.plan_tier,
    expires_at: expiresAt.toISOString(),
    days_granted: invite.days_granted,
  });
}

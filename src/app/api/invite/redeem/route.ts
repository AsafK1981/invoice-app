import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRate, clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Redeem a beta invite code. Body: { code: string }
 *
 * The check / counter-bump / redemption-insert is one atomic SQL
 * function (public.redeem_beta_invite) to close the race window
 * where N concurrent redeemers all passed the cap check before
 * anyone bumped the counter.
 *
 * Rate limit: 10 attempts per minute per IP — slows brute-force code
 * guessing. Refuses if user already has a paid Polar subscription
 * (don't want to overwrite their real sub state with beta-grant
 * fields). Just before writing app_metadata we re-fetch the user so
 * a concurrent Polar webhook write isn't silently clobbered.
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

  // Refuse if user already has a paid Polar subscription — read from
  // app_metadata (the trustworthy source) first.
  const appMeta = (user.app_metadata || {}) as Record<string, unknown>;
  const userMeta = (user.user_metadata || {}) as Record<string, unknown>;
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

  // Atomic: check existence + active + not-expired + has-slots, bump
  // counter, insert redemption row, all in one SQL call.
  const { data: result, error: rpcError } = await sb.rpc("redeem_beta_invite", {
    p_code: code,
    p_user_id: user.id,
  });

  if (rpcError) {
    console.error("redeem_beta_invite RPC failed:", rpcError);
    return NextResponse.json(
      { ok: false, error: "שגיאה בהפעלת ההזמנה" },
      { status: 500 },
    );
  }

  const r = result as
    | {
        ok: true;
        invite_id: string;
        plan_tier: "free" | "pro";
        invite_code: string;
        days_granted: number;
        expires_at: string;
      }
    | { ok: false; reason: string; already_expires_at?: string };

  if (!r.ok) {
    const map: Record<string, { status: number; text: string }> = {
      not_found: { status: 404, text: "קוד לא קיים או שגוי" },
      inactive: { status: 410, text: "הקוד הושבת" },
      expired: { status: 410, text: "הקוד פג תוקף" },
      exhausted: { status: 410, text: "הקוד נוצל במלואו" },
      already_redeemed: { status: 409, text: "כבר השתמשת בקוד הזה" },
    };
    const e = map[r.reason] || { status: 500, text: "שגיאה" };
    return NextResponse.json(
      {
        ok: false,
        error: e.text,
        ...("already_expires_at" in r ? { alreadyExpiresAt: r.already_expires_at } : {}),
      },
      { status: e.status },
    );
  }

  // Re-fetch user RIGHT before writing app_metadata so a concurrent
  // Polar webhook (e.g. checkout completing in another tab) isn't
  // silently overwritten. The window between `auth.getUser(token)` up
  // top and here can be a couple hundred ms — enough for that race
  // to fire.
  const { data: latest } = await sb.auth.admin.getUserById(user.id);
  const latestAppMeta = (latest.user?.app_metadata || {}) as Record<string, unknown>;

  await sb.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...latestAppMeta,
      plan_tier: r.plan_tier,
      plan_active: true,
      plan_beta_grant: true,
      plan_invite_code: r.invite_code,
      plan_current_period_end: r.expires_at,
    },
  });

  return NextResponse.json({
    ok: true,
    plan_tier: r.plan_tier,
    expires_at: r.expires_at,
    days_granted: r.days_granted,
  });
}

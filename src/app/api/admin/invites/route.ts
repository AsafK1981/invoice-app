import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Admin-only endpoints for managing beta invite codes.
 *
 *   GET  → list all invites with redemption counts
 *   POST → create a new invite { code?, notes?, maxRedemptions?, daysGranted?, planTier?, expiresAt? }
 *
 * Returns 404 (not 403) to non-admins to hide the endpoint's existence.
 */

async function authAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user || !isAdminEmail(user.email)) return null;
  return user;
}

export async function GET(req: NextRequest) {
  const user = await authAdmin(req);
  if (!user) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: invites, error } = await sb
    .from("beta_invites")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, invites: invites ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await authAdmin(req);
  if (!user) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    notes?: string;
    maxRedemptions?: number;
    daysGranted?: number;
    planTier?: "free" | "pro";
    expiresAt?: string | null;
  };

  // Generate a short, friendly code if none provided. Avoids confusing
  // chars (0/O, 1/I/l) and stays under 12 characters.
  const code = (body.code || randomCode()).trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
    return NextResponse.json(
      { ok: false, error: "Code must be 4-32 chars, A-Z 0-9 or dash only" },
      { status: 400 },
    );
  }

  const maxRedemptions = Math.max(1, Math.min(1000, body.maxRedemptions ?? 1));
  const daysGranted = Math.max(1, Math.min(3650, body.daysGranted ?? 90));
  const planTier = body.planTier === "free" ? "free" : "pro";
  const expiresAt = body.expiresAt || null;

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: invite, error } = await sb
    .from("beta_invites")
    .insert({
      code,
      notes: body.notes ?? null,
      max_redemptions: maxRedemptions,
      days_granted: daysGranted,
      plan_tier: planTier,
      created_by_user_id: user.id,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: "כבר קיים קוד כזה — בחר אחר" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, invite });
}

function randomCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/l
  let s = "BETA-";
  for (let i = 0; i < 6; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

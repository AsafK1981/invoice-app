import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { friendReferralCode } from "@/lib/attribution";
import { countFriendReferrals } from "@/lib/friend-referrals";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ZERO = { ok: true, joined: 0, active: 0 } as const;

/**
 * How many people joined through the caller's own invite link
 * (`/?ref=f-<code>`, see friendReferralCode), and how many of them issued a
 * document. Signed-in users only (Bearer token). The business, and so the
 * code, is resolved HERE from the authenticated user id: an id or code sent by
 * the client is never trusted, so nobody can read another user's figures.
 * Counts only, no ids, names, emails or timestamps: the invited businesses
 * are other tenants, which is also why the reads need the service role.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error } = await authClient.auth.getUser(authHeader.slice(7));
  if (error || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!serviceKey) return NextResponse.json(ZERO);

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Same pick as business-init: the user's earliest business.
  const { data: own, error: ownError } = await sb
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (ownError) {
    return NextResponse.json({ ok: false, error: "Unable to load referrals" }, { status: 500 });
  }
  if (!own) return NextResponse.json(ZERO);
  const code = friendReferralCode(own.id);

  const { data: rows, error: readError } = await sb
    .from("businesses")
    .select("id, referred_by")
    .eq("referred_by", code);
  if (readError) {
    return NextResponse.json({ ok: false, error: "Unable to load referrals" }, { status: 500 });
  }
  const referred = (rows ?? []).filter((r) => r.id !== own.id);
  if (referred.length === 0) return NextResponse.json(ZERO);

  // Which of them issued anything. Paged past PostgREST's silent 1,000-row
  // cap; business_id is the only column read.
  const activeIds = new Set<string>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data: docs, error: docsError } = await sb
      .from("documents")
      .select("business_id")
      .in("business_id", referred.map((r) => r.id))
      .neq("status", "draft")
      .is("import_batch_id", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (docsError) {
      return NextResponse.json({ ok: false, error: "Unable to load referrals" }, { status: 500 });
    }
    for (const d of docs ?? []) activeIds.add(d.business_id);
    if ((docs ?? []).length < PAGE) break;
  }

  const { joined, active } = countFriendReferrals(referred, { code, activeIds });
  return NextResponse.json({ ok: true, joined, active });
}

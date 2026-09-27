import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isInternalBusinessId } from "@/lib/internal-accounts";
import { PARTNER_ACCOUNTANTS, rankPartnerAccountants } from "@/lib/partner-accountants";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * How many ACTIVE businesses each LISTED accountant has referred, for ranking
 * /find-accountant. "Active" = issued at least one non-draft document in the
 * app (imports excluded): a referral is a client who actually works, not a
 * signup, so empty throwaway accounts cannot buy the top slot (council
 * review, 2026-09-27). Signed-in users only (Bearer token), and the answer is
 * the ORDER of the published slugs, nothing else: no counts (a tenant polling
 * exact figures could watch a partner's acquisition), no business ids, no
 * unlisted slugs, no timestamps. The cross-tenant reads need the service role
 * because the rows belong to other tenants.
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
  const joinOrder = rankPartnerAccountants(PARTNER_ACCOUNTANTS, {}).map((a) => a.slug);
  if (PARTNER_ACCOUNTANTS.length === 0 || !serviceKey) {
    return NextResponse.json({ ok: true, order: joinOrder });
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const listed = PARTNER_ACCOUNTANTS.map((a) => a.slug);
  const { data, error: readError } = await sb
    .from("businesses")
    .select("id, referred_by")
    .in("referred_by", listed);
  if (readError) {
    return NextResponse.json({ ok: false, error: "Unable to load referrals" }, { status: 500 });
  }
  const slugByBusiness = new Map<string, string>();
  for (const row of data ?? []) {
    if (!row.referred_by || isInternalBusinessId(row.id)) continue;
    slugByBusiness.set(row.id, row.referred_by);
  }
  const counts: Record<string, number> = {};
  if (slugByBusiness.size === 0) return NextResponse.json({ ok: true, order: joinOrder });

  // Which of those businesses issued anything. Paged past PostgREST's silent
  // 1,000-row cap; business_id is the only column read.
  const active = new Set<string>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data: docs, error: docsError } = await sb
      .from("documents")
      .select("business_id")
      .in("business_id", Array.from(slugByBusiness.keys()))
      .neq("status", "draft")
      .is("import_batch_id", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (docsError) {
      return NextResponse.json({ ok: false, error: "Unable to load referrals" }, { status: 500 });
    }
    for (const d of docs ?? []) active.add(d.business_id);
    if ((docs ?? []).length < PAGE) break;
  }
  for (const id of active) {
    const slug = slugByBusiness.get(id);
    if (slug) counts[slug] = (counts[slug] ?? 0) + 1;
  }
  const order = rankPartnerAccountants(PARTNER_ACCOUNTANTS, counts).map((a) => a.slug);
  return NextResponse.json({ ok: true, order });
}

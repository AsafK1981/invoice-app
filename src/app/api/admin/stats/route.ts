import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";
import { logAdminAccess } from "@/lib/admin-access-log";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Admin stats endpoint. Returns aggregate platform metrics across all
 * users: total signups, active in last 7d, total documents, etc.
 *
 * Auth: requires Bearer token belonging to a user whose email is in
 * the hardcoded admin allow-list (src/lib/admin.ts). The caller's
 * own session is validated via the anon-key client; once we know
 * the email, the ACTUAL data queries use the service-role client to
 * bypass RLS (legitimate cross-tenant aggregates).
 *
 * Metadata only, deliberately. Until 2026-08-31 this route also returned the
 * last 20 documents with client_name/number/total and the last 30 cross-tenant
 * audit_log entries with target_label + the owner's email, and the dashboard
 * painted both. That put customer content (who was invoiced, for what, for how
 * much) in front of the operator with no operational reason - the operator
 * needs counts, not contents. Both are gone: documents are now counted by type,
 * and the cross-tenant audit feed was removed outright rather than stripped,
 * because without labels it carried no signal worth a query.
 *
 * Every call writes one row to admin_access_log.
 */
export async function GET(req: NextRequest) {
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
  if (!isAdminEmail(user.email)) {
    // Don't leak that admin endpoints exist to non-admins.
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  if (!supabaseServiceKey) {
    return NextResponse.json({ ok: false, error: "Service role not configured" }, { status: 500 });
  }
  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await logAdminAccess(sb, {
    actor: user.email || user.id,
    channel: "admin_api",
    action: "admin/stats GET",
  });

  // ---- Run queries in parallel where possible ----
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    usersResult,
    docCountResult,
    docCount7dResult,
    clientCountResult,
    expenseCountResult,
    paidDocsResult,
    docs30dResult,
    businessesResult,
    distinctDocOwnersResult,
  ] = await Promise.all([
    sb.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    sb.from("documents").select("*", { count: "exact", head: true }),
    sb.from("documents").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    sb.from("clients").select("*", { count: "exact", head: true }),
    sb.from("expenses").select("*", { count: "exact", head: true }),
    sb.from("documents").select("total, total_ils, type").eq("status", "paid"),
    // Last 30 days by TYPE. No number, no client_name, no total: the columns
    // selected here are the privacy boundary, so keep the list minimal.
    sb.from("documents")
      .select("created_at, type, status")
      .gte("created_at", thirtyDaysAgo),
    // Onboarding: count businesses (proxy for "users who finished onboarding")
    sb.from("businesses").select("id, user_id"),
    // Distinct business_ids that have at least one document (engagement proxy)
    sb.from("documents").select("business_id"),
  ]);

  const allUsers = usersResult.data?.users ?? [];
  const userCount = allUsers.length;
  const activeUsers7d = allUsers.filter((u) => {
    const last = u.last_sign_in_at;
    return last && last >= sevenDaysAgo;
  }).length;
  const recentSignups = allUsers
    .slice()
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 10)
    .map((u) => ({
      id: u.id,
      email: u.email,
      provider: (u.app_metadata?.provider as string) || "email",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }));

  // Total revenue (paid docs). Credit notes are stored ALREADY NEGATIVE on
  // save (receipt-editor.tsx applies `sign = -1`), so a plain sum already
  // subtracts them - applying a sign here again would double-negate a
  // refund into extra revenue. `total_ils` normalizes foreign-currency
  // documents into shekels so they don't get summed at native face value.
  let totalRevenue = 0;
  for (const d of paidDocsResult.data ?? []) {
    totalRevenue += Number(d.total_ils ?? d.total ?? 0);
  }

  // Documents per day for last 14 days (chart data)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: dailyDocs } = await sb
    .from("documents")
    .select("created_at")
    .gte("created_at", fourteenDaysAgo);
  const perDay: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    perDay[key] = 0;
  }
  for (const row of dailyDocs ?? []) {
    const key = (row.created_at as string).slice(0, 10);
    if (key in perDay) perDay[key]++;
  }
  const dailyChart = Object.entries(perDay).map(([date, count]) => ({ date, count }));

  // Onboarding funnel:
  //   signed_up         = userCount
  //   created_business  = users with at least one row in `businesses`
  //   created_first_doc = users with at least one document
  const businesses = businessesResult.data ?? [];
  const usersWithBusiness = new Set(businesses.map((b) => b.user_id));
  const businessIdToUser: Record<string, string> = {};
  for (const b of businesses) {
    businessIdToUser[b.id] = b.user_id;
  }
  const usersWithDoc = new Set(
    (distinctDocOwnersResult.data ?? [])
      .map((r) => businessIdToUser[r.business_id as string])
      .filter(Boolean),
  );

  // Documents in the last 30 days, counted by type. Sorted by count so the
  // dashboard's list leads with what the platform is actually used for.
  const byTypeCounts: Record<string, { count: number; drafts: number }> = {};
  for (const row of docs30dResult.data ?? []) {
    const type = String(row.type);
    const bucket = (byTypeCounts[type] ??= { count: 0, drafts: 0 });
    bucket.count++;
    if (row.status === "draft") bucket.drafts++;
  }
  const byType30d = Object.entries(byTypeCounts)
    .map(([type, v]) => ({ type, count: v.count, drafts: v.drafts }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    users: {
      total: userCount,
      activeLast7d: activeUsers7d,
      recentSignups,
    },
    onboarding: {
      signedUp: userCount,
      createdBusiness: usersWithBusiness.size,
      createdFirstDoc: usersWithDoc.size,
    },
    documents: {
      total: docCountResult.count ?? 0,
      last7d: docCount7dResult.count ?? 0,
      last30d: (docs30dResult.data ?? []).length,
      byType30d,
      dailyChart,
    },
    clients: {
      total: clientCountResult.count ?? 0,
    },
    expenses: {
      total: expenseCountResult.count ?? 0,
    },
    revenue: {
      totalPaid: totalRevenue,
    },
  });
}

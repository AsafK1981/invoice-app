import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";

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
    docsRecentResult,
    businessesResult,
    auditLogResult,
    distinctDocOwnersResult,
  ] = await Promise.all([
    sb.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    sb.from("documents").select("*", { count: "exact", head: true }),
    sb.from("documents").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    sb.from("clients").select("*", { count: "exact", head: true }),
    sb.from("expenses").select("*", { count: "exact", head: true }),
    sb.from("documents").select("total, type").eq("status", "paid"),
    sb.from("documents")
      .select("created_at, type, number, client_name, total, status")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),
    // Onboarding: count businesses (proxy for "users who finished onboarding")
    sb.from("businesses").select("id, name, user_id"),
    // Audit log: last 30 entries, all tenants
    sb.from("audit_log")
      .select("id, business_id, action, target_type, target_label, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
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

  // Total revenue (paid docs, credit notes subtract)
  let totalRevenue = 0;
  for (const d of paidDocsResult.data ?? []) {
    const sign = d.type === "credit_note" ? -1 : 1;
    totalRevenue += sign * Number(d.total || 0);
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
  const businessIdToName: Record<string, string> = {};
  for (const b of businesses) {
    businessIdToUser[b.id] = b.user_id;
    businessIdToName[b.id] = b.name || "(ללא שם)";
  }
  const usersWithDoc = new Set(
    (distinctDocOwnersResult.data ?? [])
      .map((r) => businessIdToUser[r.business_id as string])
      .filter(Boolean),
  );

  // Audit log: enrich with business name + user email
  const userIdToEmail: Record<string, string> = {};
  for (const u of allUsers) userIdToEmail[u.id] = u.email || "";
  const auditEntries = (auditLogResult.data ?? []).map((row) => {
    const userId = businessIdToUser[row.business_id as string];
    return {
      id: row.id,
      action: row.action,
      target_type: row.target_type,
      target_label: row.target_label,
      created_at: row.created_at,
      business_name: businessIdToName[row.business_id as string] || "?",
      user_email: userId ? userIdToEmail[userId] || "" : "",
    };
  });

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
      recent: docsRecentResult.data ?? [],
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
    auditLog: auditEntries,
  });
}

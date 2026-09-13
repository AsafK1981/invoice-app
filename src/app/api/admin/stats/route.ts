import { NextRequest, NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";
import { logAdminAccess } from "@/lib/admin-access-log";
import { getAdminChartDay, type AdminDailyPoint } from "@/lib/admin-chart";

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
  const generatedAt = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  async function loadUsers(): Promise<User[]> {
    const users: User[] = [];
    const ids = new Set<string>();
    let expected: number | null = null;
    for (let page = 1; ; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error("Unable to load signup history");
      if (typeof data.total === "number" && data.total > 0) {
        if (expected !== null && expected !== data.total) throw new Error("Signup history changed during loading");
        expected = data.total;
      }
      for (const item of data.users) {
        if (ids.has(item.id)) throw new Error("Signup history changed during loading");
        ids.add(item.id);
      }
      users.push(...data.users.filter((item) => item.created_at <= generatedAt));
      if (expected !== null) {
        if (ids.size === expected) return users;
        if (ids.size > expected || data.users.length === 0) throw new Error("Incomplete signup history");
      } else if (data.users.length === 0) return users;
    }
  }

  async function loadDocumentChart(): Promise<AdminDailyPoint[]> {
    const counts = new Map<string, number>();
    let expected: number | null = null;
    // Stable order across pages, timestamp-only SELECT: never expose contents.
    for (let offset = 0; ;) {
      const { data, error, count } = await sb.from("documents")
        .select("created_at", { count: "exact" })
        .is("import_batch_id", null)
        .lte("created_at", generatedAt)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error || !data || count === null) throw new Error("Unable to load document history");
      if (expected !== null && expected !== count) throw new Error("Document history changed during loading");
      expected = count;
      for (const row of data) {
        const date = getAdminChartDay(row.created_at);
        counts.set(date, (counts.get(date) ?? 0) + 1);
      }
      // Advance by actual rows, even if the server has a smaller page limit.
      offset += data.length;
      if (offset === expected) break;
      if (data.length === 0 || offset > expected) throw new Error("Incomplete document history");
    }
    return Array.from(counts, ([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  try {
    const [
      allUsers,
      docCountResult,
      docCount7dResult,
      clientCountResult,
      expenseCountResult,
      paidDocsResult,
      docs30dResult,
      businessesResult,
      distinctDocOwnersResult,
      dailyChart,
    ] = await Promise.all([
      loadUsers(),
      sb.from("documents").select("*", { count: "exact", head: true }),
      sb.from("documents").select("*", { count: "exact", head: true }).is("import_batch_id", null).gte("created_at", sevenDaysAgo),
      sb.from("clients").select("*", { count: "exact", head: true }),
      sb.from("expenses").select("*", { count: "exact", head: true }),
      sb.from("documents").select("total, total_ils, type").eq("status", "paid"),
      // Last 30 days by TYPE. No number, no client_name, no total: the columns
      // selected here are the privacy boundary, so keep the list minimal.
      sb.from("admin_document_creation_daily")
        .select("day, type, document_count, document_count_30d, draft_count_30d")
        .gte("day", thirtyDaysAgo.slice(0, 10)),
      // Onboarding: count businesses (proxy for "users who finished onboarding")
      sb.from("businesses").select("id, user_id"),
      // Distinct business_ids that have at least one document (engagement proxy)
      sb.from("documents").select("business_id"),
      loadDocumentChart(),
    ]);

    if (docs30dResult.error || docCount7dResult.error) {
      return NextResponse.json({ ok: false, error: "Could not load document activity" }, { status: 500 });
    }

    const signupCounts = new Map<string, number>();
    for (const signup of allUsers) {
      const date = getAdminChartDay(signup.created_at);
      signupCounts.set(date, (signupCounts.get(date) ?? 0) + 1);
    }
    const signupChart = Array.from(signupCounts, ([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const userCount = allUsers.length;
    const activeUsers7d = allUsers.filter((u) => {
      const last = u.last_sign_in_at;
      return last && last >= sevenDaysAgo;
    }).length;
    const recentSignups = allUsers
      .slice()
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
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
      bucket.count += Number(row.document_count_30d);
      bucket.drafts += Number(row.draft_count_30d);
    }
    const byType30d = Object.entries(byTypeCounts)
      .map(([type, v]) => ({ type, count: v.count, drafts: v.drafts }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      ok: true,
      generatedAt,
      users: {
        total: userCount,
        activeLast7d: activeUsers7d,
        recentSignups,
        dailyChart: signupChart,
      },
      onboarding: {
        signedUp: userCount,
        createdBusiness: usersWithBusiness.size,
        createdFirstDoc: usersWithDoc.size,
      },
      documents: {
        total: docCountResult.count ?? 0,
        last7d: docCount7dResult.count ?? 0,
        last30d: byType30d.reduce((sum, row) => sum + row.count, 0),
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
  } catch {
    return NextResponse.json(
      { ok: false, error: "לא ניתן לטעון את היסטוריית הגרפים. נסה לרענן." },
      { status: 502 },
    );
  }
}

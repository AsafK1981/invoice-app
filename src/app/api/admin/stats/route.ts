import { NextRequest, NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";
import { logAdminAccess } from "@/lib/admin-access-log";
import { getAdminChartDay, type AdminDailyPoint } from "@/lib/admin-chart";
import { countsForTurnover } from "@/lib/ita/income-tax-advances";
import { resolveInternalAccounts } from "@/lib/internal-accounts";
import { lowerMedian } from "@/lib/median";
import { PLANS, getPlanStatus } from "@/lib/plans";
import type { InvoiceDocument } from "@/lib/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Admin stats endpoint. Returns aggregate platform metrics across all users.
 *
 * The `people` block is the one the dashboard leads with, and every figure in
 * it EXCLUDES our own accounts (see src/lib/internal-accounts.ts). Six of the
 * signups are the founder, his father's tax-testing business, the demo, the QA
 * account, an old throwaway and the Lynkeus bot; counting them made the
 * product look about a third busier than it is. `registered` keeps the raw
 * total beside `real` so the two are never mistaken for each other.
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
type TurnoverRow = {
  subtotal: number | null;
  subtotal_ils: number | null;
  type: string;
  status: string;
  converted_to_id: string | null;
  business_id: string;
  import_batch_id: string | null;
};

type DocOwnerRow = {
  business_id: string;
  created_at: string;
  import_batch_id: string | null;
};

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
  // Only used to say whether the last 30 days beat the 30 before them.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

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

  /**
   * PostgREST caps an unbounded SELECT at 1000 rows and says nothing about it.
   * The cross-tenant reads below page explicitly: a silent cap would freeze a
   * growing total at a plausible-looking wrong number. Ordered by `id` so
   * pages can't overlap or skip.
   */
  async function loadAll<T>(
    table: string,
    columns: string,
    filter?: { in?: [string, string[]] },
  ): Promise<T[]> {
    const rows: T[] = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      let q = sb.from(table).select(columns).order("id", { ascending: true });
      if (filter?.in) q = q.in(...filter.in);
      const { data, error } = await q.range(offset, offset + PAGE - 1);
      if (error) throw new Error(`Unable to load ${table}`);
      const page = (data ?? []) as unknown as T[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  try {
    const [
      allUsers,
      turnoverDocs,
      docs30dResult,
      businessesResult,
      docOwnerRows,
      dailyChart,
    ] = await Promise.all([
      loadUsers(),
      // Paid AND sent: a credit note is saved "sent" and still reduces turnover.
      loadAll<TurnoverRow>(
        "documents",
        "subtotal, subtotal_ils, type, status, converted_to_id, business_id, import_batch_id",
        { in: ["status", ["paid", "sent"]] },
      ),
      // Last 30 days by TYPE. No number, no client_name, no total: the columns
      // selected here are the privacy boundary, so keep the list minimal.
      sb.from("admin_document_creation_daily")
        .select("day, type, document_count, document_count_30d, draft_count_30d")
        .gte("day", thirtyDaysAgo.slice(0, 10)),
      // Onboarding: count businesses (proxy for "users who finished onboarding")
      loadAll<{ id: string; user_id: string }>("businesses", "id, user_id"),
      // Who produced what, and when. Three columns, all metadata: the owning
      // business, the timestamp, and whether the row arrived through a bulk
      // import. Never a number, a client or an amount.
      loadAll<DocOwnerRow>("documents", "business_id, created_at, import_batch_id"),
      loadDocumentChart(),
    ]);

    if (docs30dResult.error) {
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

    // Our own accounts: the explicit business list (founder, father's
    // tax-testing business, demo, QA) plus any `.internal` login. Their
    // turnover is not customer usage and neither is their activity, so every
    // "how is the product doing" figure below is computed WITHOUT them. The
    // raw signup total stays available beside it, because "23 registered, 6
    // of them mine" is itself a fact the operator needs.
    const businessIdToUser: Record<string, string> = {};
    const allBusinessOwners = new Set<string>();
    for (const b of businessesResult) {
      businessIdToUser[b.id] = b.user_id;
      allBusinessOwners.add(b.user_id);
    }
    const { internalUserIds, internalBusinessIds } = resolveInternalAccounts({
      users: allUsers,
      businesses: businessesResult,
    });

    // Documents produced per account. Bulk imports are excluded on purpose:
    // a migrated history of 300 old invoices is not 300 acts of using the
    // product, and mixing the two made one imported account look like the
    // heaviest user on the platform.
    type UserDocStats = { total: number; last30d: number; last7d: number };
    const docsByUser = new Map<string, UserDocStats>();
    let importedByUserCount = 0;
    for (const row of docOwnerRows) {
      const userId = businessIdToUser[row.business_id];
      if (!userId) continue;
      if (row.import_batch_id) {
        importedByUserCount++;
        continue;
      }
      const bucket = docsByUser.get(userId) ?? { total: 0, last30d: 0, last7d: 0 };
      bucket.total++;
      if (row.created_at >= thirtyDaysAgo) bucket.last30d++;
      if (row.created_at >= sevenDaysAgo) bucket.last7d++;
      docsByUser.set(userId, bucket);
    }
    const NO_DOCS: UserDocStats = { total: 0, last30d: 0, last7d: 0 };

    // One pass over the real accounts for every headline figure. They were
    // nine separate traversals, each re-reading the same map entry.
    let activeUsers7d = 0;
    let activeUsers30d = 0;
    let signups30d = 0;
    let signupsPrev30d = 0;
    let realUsersWithBusiness = 0;
    let producers30d = 0;
    let producers7d = 0;
    let produced30d = 0;
    let realUserCount = 0;
    // The goal widget's numbers. A paying subscriber is a real account whose
    // plan (app_metadata only, see getPlanStatus) is a paid tier, active, not
    // a beta grant and past its trial. Trials and grants are counted apart so
    // the widget can say "and N more on trial" without inflating the goal.
    // Gross income is the tier's monthly list price; a yearly subscriber pays
    // ~17% less than that, close enough for a progress bar.
    let payingSubscribers = 0;
    let trialingSubscribers = 0;
    let betaGrants = 0;
    let grossMonthlyIls = 0;
    const producerCounts: number[] = [];
    for (const u of allUsers) {
      if (internalUserIds.has(u.id)) continue;
      realUserCount++;
      const plan = getPlanStatus(u);
      if (plan.tier !== "free" && plan.active) {
        if (u.app_metadata?.plan_beta_grant === true) betaGrants++;
        else if (plan.trialing) trialingSubscribers++;
        else {
          payingSubscribers++;
          grossMonthlyIls += PLANS[plan.tier].priceMonthly;
        }
      }
      if (u.last_sign_in_at && u.last_sign_in_at >= sevenDaysAgo) activeUsers7d++;
      if (u.last_sign_in_at && u.last_sign_in_at >= thirtyDaysAgo) activeUsers30d++;
      if (u.created_at >= thirtyDaysAgo) signups30d++;
      else if (u.created_at >= sixtyDaysAgo) signupsPrev30d++;
      if (allBusinessOwners.has(u.id)) realUsersWithBusiness++;
      const docs = docsByUser.get(u.id) ?? NO_DOCS;
      if (docs.total > 0) producerCounts.push(docs.total);
      if (docs.last30d > 0) producers30d++;
      if (docs.last7d > 0) producers7d++;
      produced30d += docs.last30d;
    }
    const producedTotal = producerCounts.reduce((sum, n) => sum + n, 0);
    const medianPerProducer = producerCounts.length === 0 ? 0 : lowerMedian(producerCounts);
    const topProducer = producerCounts.reduce((max, n) => (n > max ? n : max), 0);

    // One row per account. The page sorts and filters it client-side, so there
    // is no order to establish here. Counts and timestamps only: no client
    // names, no subjects, no amounts.
    const recentSignups = allUsers.map((u) => {
      const docs = docsByUser.get(u.id) ?? NO_DOCS;
      return {
        id: u.id,
        email: u.email,
        provider: (u.app_metadata?.provider as string) || "email",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        internal: internalUserIds.has(u.id),
        hasBusiness: allBusinessOwners.has(u.id),
        documents: docs.total,
        documents30d: docs.last30d,
      };
    });

    // Cross-tenant turnover, split into what was created in the app and what
    // was imported from another vendor. Until 2026-09-14 this was one plain
    // sum of status=paid totals that read 928,406.78 while the in-app turnover
    // was ~193k: about 72% was two bulk history imports, converted
    // invoice+receipt pairs were counted twice, and dealers' VAT was included.
    //
    // Rule: `countsForTurnover`, the gate the tax reports use (drops converted
    // sources, non-revenue types, drafts and cancelled; keeps credit notes by
    // issuance). Amounts are `subtotal`, before VAT: VAT a dealer collects is
    // the state's money, and summing gross mixes VAT-inclusive dealers with
    // VAT-free exempt ones. Credit notes are stored negative; never negate.
    let inAppTurnover = 0;
    let importedTurnover = 0;
    for (const d of turnoverDocs) {
      if (internalBusinessIds.has(d.business_id)) continue;
      if (!countsForTurnover({
        type: d.type as InvoiceDocument["type"],
        status: d.status as InvoiceDocument["status"],
        convertedToId: d.converted_to_id ?? undefined,
      })) continue;
      const net = Number(d.subtotal_ils ?? d.subtotal ?? 0);
      if (d.import_batch_id) importedTurnover += net;
      else inAppTurnover += net;
    }

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
        recentSignups,
        dailyChart: signupChart,
      },
      // The product's own scoreboard. Every figure here excludes our accounts,
      // and the onboarding funnel reads the same three fields rather than
      // shipping its own copy of them.
      people: {
        registered: userCount,
        internal: internalUserIds.size,
        real: realUserCount,
        activeLast7d: activeUsers7d,
        activeLast30d: activeUsers30d,
        signupsLast30d: signups30d,
        signupsPrev30d,
        withBusiness: realUsersWithBusiness,
        producers: producerCounts.length,
        producers30d,
        producers7d,
        producedTotal,
        produced30d,
        avgPerProducer: producerCounts.length === 0
          ? 0
          : Math.round((producedTotal / producerCounts.length) * 10) / 10,
        medianPerProducer,
        topProducer,
        importedDocuments: importedByUserCount,
      },
      subscribers: {
        paying: payingSubscribers,
        trialing: trialingSubscribers,
        betaGrants,
        grossMonthlyIls,
      },
      documents: {
        last30d: byType30d.reduce((sum, row) => sum + row.count, 0),
        byType30d,
        dailyChart,
      },
      revenue: {
        inAppTurnover,
        importedTurnover,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "לא ניתן לטעון את היסטוריית הגרפים. נסה לרענן." },
      { status: 502 },
    );
  }
}

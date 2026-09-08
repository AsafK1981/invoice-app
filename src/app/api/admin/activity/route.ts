import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";
import { logAdminAccess } from "@/lib/admin-access-log";
import { buildAdminActivity } from "@/lib/admin-activity";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Admin activity feed: recent platform usage as metadata only.
 *
 * Each event is "account X (business name) did a thing of kind K at time T":
 * a document of a given type was created / emailed / marked paid, an expense
 * or a client was added, a user signed in. The SELECT lists below are the
 * privacy boundary - no number, subject, client name, amount or bank detail
 * is ever read. See src/lib/admin-activity.ts for why this is built from the
 * source tables rather than from audit_log.
 *
 * Auth mirrors /api/admin/stats: Bearer token, admin allow-list, service role
 * for the cross-tenant reads, one row in admin_access_log per call.
 *
 * ?limit= caps the merged feed (default 50, max 200).
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
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  if (!supabaseServiceKey) {
    return NextResponse.json({ ok: false, error: "Service role not configured" }, { status: 500 });
  }

  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 50;
  // Each source is fetched a little deeper than the final cap so a burst from
  // one table cannot hide the newest rows of another before the merge.
  const perSource = Math.min(limit * 2, 400);

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await logAdminAccess(sb, {
    actor: user.email || user.id,
    channel: "admin_api",
    action: "admin/activity GET",
    detail: { limit },
  });

  const DOC_COLUMNS = "id, business_id, type, status, created_at, emailed_at, paid_at";

  const [
    createdDocs,
    emailedDocs,
    paidDocs,
    expenses,
    clients,
    businesses,
    usersResult,
  ] = await Promise.all([
    sb.from("documents").select(DOC_COLUMNS).order("created_at", { ascending: false }).limit(perSource),
    sb.from("documents").select(DOC_COLUMNS).not("emailed_at", "is", null).order("emailed_at", { ascending: false }).limit(perSource),
    sb.from("documents").select(DOC_COLUMNS).not("paid_at", "is", null).order("paid_at", { ascending: false }).limit(perSource),
    sb.from("expenses").select("id, business_id, created_at").order("created_at", { ascending: false }).limit(perSource),
    sb.from("clients").select("id, business_id, created_at").order("created_at", { ascending: false }).limit(perSource),
    sb.from("businesses").select("id, user_id, name"),
    sb.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const failed = [createdDocs, emailedDocs, paidDocs, expenses, clients, businesses].find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ ok: false, error: failed.error.message }, { status: 500 });
  }
  if (usersResult.error) {
    return NextResponse.json({ ok: false, error: usersResult.error.message }, { status: 500 });
  }

  const events = buildAdminActivity({
    documents: [
      ...(createdDocs.data ?? []),
      ...(emailedDocs.data ?? []),
      ...(paidDocs.data ?? []),
    ],
    expenses: expenses.data ?? [],
    clients: clients.data ?? [],
    businesses: businesses.data ?? [],
    users: (usersResult.data?.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
    })),
    limit,
  });

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    events,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";
import { logAdminAccess } from "@/lib/admin-access-log";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Admin-only: list every user with their primary business + counts
 * (clients, products, documents, expenses). Used by /admin/import-for-user
 * to let the owner pick a target before pushing data into their account.
 *
 * Optional ?q= filters by email or business name (case-insensitive).
 * Returns 404 to non-admins.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const token = authHeader.slice(7);

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user || !isAdminEmail(user.email)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await logAdminAccess(sb, {
    actor: user.email || user.id,
    channel: "admin_api",
    action: "admin/users GET",
  });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").toLowerCase().trim();

  // Pull users + businesses + per-business counts in parallel.
  const [usersResult, businessesResult, clientCountsResult, productCountsResult, docCountsResult] = await Promise.all([
    sb.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    sb.from("businesses").select("id, name, user_id"),
    sb.from("clients").select("business_id"),
    sb.from("products").select("business_id"),
    sb.from("documents").select("business_id"),
  ]);

  const businessesByUser = new Map<string, { id: string; name: string }>();
  for (const b of businessesResult.data || []) {
    if (!businessesByUser.has(b.user_id)) {
      businessesByUser.set(b.user_id, { id: b.id, name: b.name || "(ללא שם)" });
    }
  }

  const tally = (rows: Array<{ business_id: string }> | null) => {
    const c = new Map<string, number>();
    for (const r of rows || []) c.set(r.business_id, (c.get(r.business_id) || 0) + 1);
    return c;
  };
  const clientCounts = tally(clientCountsResult.data);
  const productCounts = tally(productCountsResult.data);
  const docCounts = tally(docCountsResult.data);

  const list = (usersResult.data?.users || []).map((u) => {
    const biz = businessesByUser.get(u.id);
    return {
      id: u.id,
      email: u.email || "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at || null,
      business: biz
        ? {
            id: biz.id,
            name: biz.name,
            clients: clientCounts.get(biz.id) || 0,
            products: productCounts.get(biz.id) || 0,
            documents: docCounts.get(biz.id) || 0,
          }
        : null,
    };
  });

  const filtered = q
    ? list.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.business?.name || "").toLowerCase().includes(q),
      )
    : list;

  filtered.sort((a, b) => (b.last_sign_in_at || "").localeCompare(a.last_sign_in_at || ""));

  return NextResponse.json({ ok: true, users: filtered });
}

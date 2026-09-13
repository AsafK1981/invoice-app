import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";
import { logAdminAccess } from "@/lib/admin-access-log";
import { activityRowToEvent, decodeActivityCursor, encodeActivityCursor, type ActivityEventRow } from "@/lib/admin-activity-pagination";

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
 * ?limit= sets page size (default 50, max 200); cursor traverses all available events.
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
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor ? decodeActivityCursor(rawCursor, supabaseServiceKey) : null;
  if (rawCursor && !cursor) {
    return NextResponse.json({ ok: false, error: "Invalid cursor" }, { status: 400 });
  }
  const cutoff = cursor?.cutoff ?? new Date().toISOString();

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await logAdminAccess(sb, {
    actor: user.email || user.id,
    channel: "admin_api",
    action: "admin/activity GET",
    detail: { limit },
  });

  // One row per event, already grouped and filtered in SQL. Preserve the raw
  // timestamp in the cursor: converting through Date loses microseconds.
  let query = sb.from("admin_activity_events")
    .select("event_id, at, kind, email, business_name, document_type, draft, document_count, client_count, expense_count, product_count")
    .lte("at", cutoff)
    .order("at", { ascending: false }).order("event_id", { ascending: false })
    .limit(limit + 1);
  if (cursor) {
    query = query.or("at.lt." + cursor.at + ",and(at.eq." + cursor.at + ",event_id.lt." + cursor.id + ")");
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: "Could not load activity" }, { status: 500 });
  const rows = (data ?? []) as ActivityEventRow[];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last
    ? encodeActivityCursor({ at: last.at, id: last.event_id, cutoff }, supabaseServiceKey)
    : null;
  return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), events: page.map(activityRowToEvent), nextCursor });
}

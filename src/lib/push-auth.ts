// Shared "who is calling" for the three /api/push routes.
//
// Same shape as resolveInboxCaller in email-inbox-server.ts: validate the
// Bearer token with the anon client's auth.getUser(), and only then build a
// service-role client. `push_subscriptions` does have RLS policies, but these
// routes write with the service role (upsert by endpoint needs it), so every
// query they run must carry the business id resolved here - the database is
// not going to scope it for them.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export type PushCaller =
  | { ok: true; admin: SupabaseClient; userId: string; businessId: string }
  | { ok: false; response: NextResponse };

export async function resolvePushCaller(req: Request): Promise<PushCaller> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  const token = authHeader.slice(7);

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Same "first business by created_at" rule the rest of the app uses.
  const { data: rows, error } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) {
    console.error("[push] business lookup failed:", error.message);
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "שגיאה בטעינת העסק." }, { status: 500 }),
    };
  }
  const row = rows?.[0];
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "לא נמצא עסק למשתמש הזה." }, { status: 404 }),
    };
  }

  return { ok: true, admin, userId: user.id, businessId: row.id as string };
}

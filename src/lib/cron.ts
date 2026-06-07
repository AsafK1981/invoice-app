import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const cronSecret = process.env.CRON_SECRET;

/**
 * Verify a request carries the Vercel Cron bearer secret. Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET is
 * set as an env var. Returns a 401 response to return early with, or null
 * when the request is authorized.
 *
 * Shared by every /api/cron/* route so the auth scheme lives in one place.
 */
export function cronAuthError(req: Request): NextResponse | null {
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Service-role Supabase client for cron jobs (no session persistence). */
export function cronAdminClient(): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

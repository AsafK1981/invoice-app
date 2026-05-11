import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Public health-check endpoint. No auth — designed to be hit by
 * external uptime monitors (BetterUptime, UptimeRobot, etc.) and
 * by our own admin dashboard.
 *
 * Returns 200 when every dependency is reachable, 503 if any
 * critical dependency fails. The body is always JSON with a
 * per-component breakdown so the dashboard can show which piece
 * is sick.
 *
 * Deploy SHA is omitted from the public response (info-leak: lets
 * attackers pin known-vulnerable code paths). Admins who pass a
 * valid Bearer token still get it for the dashboard.
 *
 * NOT cached — Vercel + Next.js default to no-store for API
 * routes, but we set explicit headers anyway in case anyone
 * proxies this.
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();

  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  // Database — does a count query that requires actual SQL execution.
  try {
    const t0 = Date.now();
    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await sb.from("businesses").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    checks.database = { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    checks.database = { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }

  // Storage — list buckets (lightweight metadata call).
  try {
    const t0 = Date.now();
    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await sb.storage.listBuckets();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("no buckets");
    checks.storage = { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    checks.storage = { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }

  // Auth — list one user (cheap admin-API call).
  try {
    const t0 = Date.now();
    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw new Error(error.message);
    checks.auth = { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    checks.auth = { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  const status = allOk ? 200 : 503;

  // Only show deploy SHA to authenticated admins. Anonymous callers
  // get the same operational picture without the version pin.
  let showVersion = false;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const authClient = createClient(supabaseUrl, supabaseAnonKey);
      const { data: { user } } = await authClient.auth.getUser(authHeader.slice(7));
      if (user && isAdminEmail(user.email)) showVersion = true;
    } catch {
      // ignore — non-admins just don't see the version
    }
  }

  return NextResponse.json(
    {
      ok: allOk,
      status: allOk ? "operational" : "degraded",
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      checks,
      ...(showVersion
        ? { version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "unknown" }
        : {}),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

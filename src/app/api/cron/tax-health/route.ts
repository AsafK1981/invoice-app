import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { isTaxAuthorityConfigured, taxAuthorityEnv } from "@/lib/tax-authority";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const cronSecret = process.env.CRON_SECRET;

/**
 * Daily health check for the "חשבונית ישראל" (Israel Tax Authority)
 * integration, which went live 2026-06-07.
 *
 * The allocation route writes any failure (token refresh OR allocation
 * rejection) to tax_authority_credentials.last_error, and clears it to
 * null on success. So a single query over that column tells us whether
 * any connected business has hit a problem. If so, we surface it in
 * Sentry (the user already has Sentry alerts wired) so the first failed
 * allocation gets caught early — even when no dev session is running.
 *
 * Provisional-config note: the software number is currently Asaf's
 * business number (049040686) rather than a real software-registry
 * number (#1973 still pending). If allocations start failing with a
 * software-number error, that env var is the first thing to revisit.
 */
export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: creds, error } = await admin
    .from("tax_authority_credentials")
    .select("business_id, vat_number, environment, connected_at, last_used_at, last_error");

  if (error) {
    Sentry.captureMessage("tax-health cron: failed to read tax_authority_credentials", {
      level: "error",
      tags: { kind: "tax-health" },
      extra: { error: error.message },
    });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = creds || [];
  const failures = rows.filter((c) => c.last_error);

  const summary = {
    timestamp: new Date().toISOString(),
    vendorConfigured: isTaxAuthorityConfigured(),
    environment: taxAuthorityEnv(),
    connectedBusinesses: rows.length,
    failures: failures.map((f) => ({
      businessId: f.business_id,
      vatNumber: f.vat_number,
      lastError: f.last_error,
      lastUsedAt: f.last_used_at,
    })),
  };

  if (failures.length > 0) {
    Sentry.captureMessage(
      `חשבונית ישראל: ${failures.length} business(es) with a failed allocation`,
      {
        level: "warning",
        tags: { kind: "tax-allocation-failure" },
        extra: summary,
      },
    );
  }

  return NextResponse.json(summary, { status: failures.length > 0 ? 500 : 200 });
}

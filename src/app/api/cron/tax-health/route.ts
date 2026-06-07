import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { isTaxAuthorityConfigured, taxAuthorityEnv } from "@/lib/tax-authority";
import { cronAuthError, cronAdminClient } from "@/lib/cron";

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
  const unauth = cronAuthError(req);
  if (unauth) return unauth;

  const admin = cronAdminClient();

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

import { NextRequest, NextResponse } from "next/server";

/**
 * TEMPORARY diagnostic — probes Vercel→gov.il token-endpoint reachability.
 * Uses dummy credentials so nothing sensitive is sent or returned; the gov
 * server replies 400/401 if reachable, or the fetch throws a network error
 * (ETIMEDOUT / ECONNRESET / ENETUNREACH …) we surface via err.cause.
 *
 * Gated behind ?key=<CRON_SECRET>. Delete this route once the connectivity
 * root cause is confirmed.
 */
export const dynamic = "force-dynamic";

async function probe(label: string, url: string) {
  const started = Date.now();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=dummy&redirect_uri=https://mysuperfriendlyinvoiceapp.vercel.app/api/tax-authority/callback",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await r.text();
    return { label, url, ok: true, status: r.status, ms: Date.now() - started, body: text.slice(0, 300) };
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: unknown };
    const cause = e.cause as { code?: string; errno?: number; message?: string } | undefined;
    return {
      label,
      url,
      ok: false,
      ms: Date.now() - started,
      errorName: e.name,
      errorMessage: e.message,
      causeCode: cause?.code,
      causeErrno: cause?.errno,
      causeMessage: cause?.message,
    };
  }
}

export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const results = await Promise.all([
    probe("prod-token", "https://openapi.taxes.gov.il/shaam/production/longtimetoken/oauth2/token"),
    probe("sandbox-token", "https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token"),
  ]);

  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? null,
    deploymentUrl: process.env.VERCEL_URL ?? null,
    results,
  });
}

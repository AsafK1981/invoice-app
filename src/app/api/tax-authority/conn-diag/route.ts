import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * TEMPORARY diagnostic — probes Vercel→gov.il token-endpoint reachability.
 * Uses dummy credentials so nothing sensitive is sent or returned; the gov
 * server replies 400/401 if reachable, or the fetch throws a network error
 * (ETIMEDOUT / ECONNRESET / ENETUNREACH …) we surface via err.cause.
 *
 * Auth: x-diag-key header (never the URL, so it can't leak via access logs)
 * compared constant-time against TAX_DIAG_KEY. Delete this route + env var
 * once the connectivity root cause is confirmed.
 */
export const dynamic = "force-dynamic";
// Run from Frankfurt — closest Vercel region to Israel. iad1 (US East)
// can't complete the TCP handshake to gov.il within undici's 10s connect
// timeout; fra1's ~60ms RTT does.
export const preferredRegion = "fra1";

function keyOk(provided: string | null): boolean {
  const expected = process.env.TAX_DIAG_KEY;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function probe(label: string, url: string, extraHeaders: Record<string, string> = {}) {
  const started = Date.now();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...extraHeaders },
      body: "grant_type=authorization_code&code=dummy&redirect_uri=https://mysuperfriendlyinvoiceapp.vercel.app/api/tax-authority/callback",
      signal: AbortSignal.timeout(25_000),
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
  if (!keyOk(req.headers.get("x-diag-key"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const proxyBase = (process.env.TAX_AUTHORITY_PROXY_BASE || "").replace(/\/$/, "");
  const proxyKey = process.env.TAX_AUTHORITY_PROXY_KEY || "";

  const probes: Array<Promise<unknown>> = [
    probe("direct-prod-token", "https://openapi.taxes.gov.il/shaam/production/longtimetoken/oauth2/token"),
  ];
  if (proxyBase) {
    probes.push(
      probe(
        "via-proxy-prod-token",
        `${proxyBase}/openapi/shaam/production/longtimetoken/oauth2/token`,
        { "x-proxy-key": proxyKey },
      ),
    );
  }
  const results = await Promise.all(probes);

  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? null,
    proxyConfigured: !!proxyBase,
    results,
  });
}

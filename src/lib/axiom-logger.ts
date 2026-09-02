// Direct-ingest Axiom logger for the hot tier of the two-tier log
// retention (info-security appendix §19). We POST events directly to
// Axiom's ingest endpoint from inside Next.js routes; the weekly
// `/api/cron/axiom-archive` then siphons those events into Supabase
// Storage for the cold (12+ month) tier.
//
// Why not the Vercel→Axiom integration? It requires Vercel Pro
// ($20/mo) because Log Drains aren't on Hobby. Direct ingest is free
// and captures everything our application code generates, which is
// what the appendix actually requires.
//
// 2026-09-02: this file had never delivered a single event. Three
// separate faults, each of which alone was enough, and all of them
// invisible because the catch below swallowed everything:
//
//   1. Wrong host. It used AXIOM_API_BASE (api.eu.axiom.co), which
//      403s. Probed live: api.axiom.co answers
//      "must use the eu-central-1 edge deployment domain", and only
//      https://eu-central-1.aws.edge.axiom.co accepts ingest.
//   2. Wrong path. Ingest is /v1/ingest/<dataset>, not
//      /v1/datasets/<dataset>/ingest (that path 404s on the edge host).
//   3. Fire-and-forget. Vercel kills outstanding fetches when the
//      handler returns, which the old comment admitted while doing it
//      anyway.
//
// Faults 1 and 2 are fixed below and are what actually kept every event
// from landing. Fault 3 is NOT fixed here, on purpose: the obvious fix is
// `after()` from next/server, but this module is reachable from a client
// bundle (tax-authority.ts is imported by app/(app)/documents/[id]/page.tsx),
// and importing next/server there fails the build outright. Tried on
// 2026-09-02 and it broke production. The one path where a dropped event
// would really hurt, an allocation rejection, is covered by an awaited
// Sentry.captureMessage in api/tax-authority/request-allocation instead.
// If this ever needs to be airtight, move logToAxiom behind a route rather
// than importing a server-only API into shared code.
//
// AXIOM_API_BASE is deliberately NOT reused here: /api/cron/axiom-archive
// needs it for the control-plane `_apl` query, which the edge host does
// not serve. Ingest and query are different hosts; keep them separate.

const AXIOM_INGEST_TOKEN = process.env.AXIOM_INGEST_TOKEN || "";
const AXIOM_DATASET = process.env.AXIOM_DATASET || "mysuperfriendlyinvoiceapp";
// The dataset's edge deployment, NOT the control plane. Overridable because
// the edge host is a property of where the dataset lives, not of the code.
const AXIOM_INGEST_BASE =
  process.env.AXIOM_INGEST_URL || "https://eu-central-1.aws.edge.axiom.co";

export interface AxiomEvent {
  /** Anything serializable. `_time` is auto-set if missing. */
  [key: string]: unknown;
}

async function post(payload: unknown[]): Promise<void> {
  try {
    const r = await fetch(`${AXIOM_INGEST_BASE}/v1/ingest/${AXIOM_DATASET}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AXIOM_INGEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      // Loud on purpose. A silent log pipeline is worse than none: it reads
      // as compliance while delivering nothing, which is exactly what
      // happened here for months. Body is Axiom's own error, not user data.
      console.error(
        "[axiom] ingest rejected",
        r.status,
        (await r.text().catch(() => "")).slice(0, 300),
      );
    }
  } catch (err) {
    console.error("[axiom] ingest failed", err instanceof Error ? err.message : err);
  }
}

/**
 * Log one event. Never throws.
 *
 * Returns the in-flight POST so a SERVER caller can await it. That await is
 * not optional in practice: Vercel tears the function down as soon as the
 * handler returns, and a fire-and-forget fetch to Axiom loses the race on
 * every fast path. Verified on 2026-09-02 by emitting a real production
 * security event with the URL already corrected and finding nothing in the
 * dataset. Callers that cannot await (client-reachable code) may still drop
 * the promise; they simply lose the event.
 */
export function logToAxiom(event: AxiomEvent): Promise<void> {
  if (!AXIOM_INGEST_TOKEN) return Promise.resolve(); // disabled (dev or unconfigured)
  return post([{ _time: new Date().toISOString(), ...event }]);
}

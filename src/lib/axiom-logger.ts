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
// Edge-safe: only uses fetch + Node Buffer-less serialization, so it
// works in both the Node and Edge runtimes.

const AXIOM_INGEST_TOKEN = process.env.AXIOM_INGEST_TOKEN || "";
const AXIOM_DATASET = process.env.AXIOM_DATASET || "mysuperfriendlyinvoiceapp";
// EU instance because the org was created on EU Central 1.
const AXIOM_BASE = process.env.AXIOM_API_BASE || "https://api.eu.axiom.co";

export interface AxiomEvent {
  /** Anything serializable. `_time` is auto-set if missing. */
  [key: string]: unknown;
}

/**
 * Fire-and-forget log. Never throws, never rejects, returns
 * immediately; the POST runs in the background. Caller does not
 * await; logging failure must never affect the user request.
 */
export function logToAxiom(event: AxiomEvent): void {
  if (!AXIOM_INGEST_TOKEN) return; // ingest disabled (dev or unconfigured)

  const payload = [{ _time: new Date().toISOString(), ...event }];

  // Fire and forget; we use void on the promise so the linter doesn't
  // flag the floating call.
  void fetch(`${AXIOM_BASE}/v1/datasets/${AXIOM_DATASET}/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AXIOM_INGEST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    // Vercel's serverless runtime kills outstanding fetches when the
    // handler returns, so we keep this very short and accept dropped
    // events under high load.
  }).catch(() => {
    // Silently swallow; Sentry already captures errors at a higher
    // level; if Axiom is down we don't want to pollute Sentry too.
  });
}

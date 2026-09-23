import { handleTranzilaCallback } from "@/lib/tranzila-callback";

/**
 * Browser-facing landing spot for a DirectNG hosted-page capture: the URL we
 * pass as `success_url_address` / `fail_url_address`. Tranzila sends the
 * CUSTOMER here with the transaction payload, by POST or GET depending on
 * terminal configuration, so both verbs are wired.
 *
 * It carries no secret (the customer can read this URL) and it WRITES NOTHING:
 * it logs a redacted summary and redirects to /billing. Persistence belongs to
 * /api/tranzila/notify, which is the leg that never passes through the
 * customer's machine. `?diag=1` renders the diagnostic table instead of
 * redirecting, for live-terminal testing.
 *
 * Pointing this at a React page instead would 405: DirectNG POSTs the result,
 * and /billing has no POST handler.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleTranzilaCallback(req);
}

export async function GET(req: Request): Promise<Response> {
  return handleTranzilaCallback(req);
}

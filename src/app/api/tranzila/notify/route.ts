import { handleTranzilaNotify } from "@/lib/tranzila-notify";

/**
 * Server-to-server copy of the DirectNG result payload: the URL we pass as
 * `notify_url_address`, carrying the per-checkout single-use nonce.
 *
 * CONFIRMED 2026-09-23 with Tranzila support that this copy carries the FULL
 * payload including `TranzilaTK`, which is why it - not the browser round trip
 * - is the ONLY writer. All of the reasoning and the write path live in
 * src/lib/tranzila-notify.ts + src/lib/tranzila-activation.ts.
 *
 * Unauthenticated in the HTTP sense on purpose (Tranzila initiates it, there
 * is no session); the nonce is what authenticates it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleTranzilaNotify(req);
}

export async function GET(req: Request): Promise<Response> {
  return handleTranzilaNotify(req);
}

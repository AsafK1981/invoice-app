import type { Client, InvoiceDocument } from "./types";
import { resolveDocumentClientId } from "./client-picker";
import { computeClientAccount } from "./aging";

export interface ClientStats {
  /** Issued (not draft / cancelled) documents of any type, quotes included. */
  docCount: number;
  /** computeClientAccount's billed: no quotes, no converted documents, credit notes net. */
  totalBilled: number;
  lastDocDate: string | null;
}

/**
 * Per-client card figures for /clients. Unlinked documents (client_id null)
 * are attributed to the one client their name / tax id identifies, so the
 * count here agrees with the client page and the documents list. Billed
 * uses the same account rule as the client page and statement.
 */
export function buildStatsByClient(documents: InvoiceDocument[], clients: Client[]): Map<string, ClientStats> {
  const byClient = new Map<string, InvoiceDocument[]>();
  for (const d of documents) {
    if (d.status === "draft" || d.status === "cancelled") continue;
    const clientId = resolveDocumentClientId(d, clients);
    if (!clientId) continue;
    const list = byClient.get(clientId);
    if (list) list.push(d);
    else byClient.set(clientId, [d]);
  }
  const m = new Map<string, ClientStats>();
  for (const [clientId, docs] of byClient) {
    let lastDocDate: string | null = null;
    for (const d of docs) if (!lastDocDate || d.date > lastDocDate) lastDocDate = d.date;
    m.set(clientId, { docCount: docs.length, totalBilled: computeClientAccount(docs).billed, lastDocDate });
  }
  return m;
}

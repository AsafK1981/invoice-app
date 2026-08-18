import type { Client, InvoiceDocument } from "./types";
import { normalizeName, resolveDocumentClientId } from "./client-picker";

/**
 * Open-receivables ("aging") math, shared by the reports overview card and
 * the full <AgingReport> table so the two never disagree on a shekel.
 */

export interface AgingRow {
  clientId: string;
  clientName: string;
  /** 0-30, 31-60, 61-90, 90+ days since issue */
  buckets: [number, number, number, number];
  total: number;
  docs: InvoiceDocument[];
}

export interface AgingTotals {
  buckets: [number, number, number, number];
  grand: number;
  docCount: number;
}

export const AGING_BUCKET_LABELS = ["0-30 ימים", "31-60 ימים", "61-90 ימים", "מעל 90 ימים"];

/**
 * Days since the document was issued (the freelancer's proxy for "due").
 * Calendar day to calendar day in UTC, so a doc issued 30 days ago at any
 * hour lands in the same bucket regardless of the viewer's local time.
 */
export function daysOverdue(doc: InvoiceDocument, now = new Date()): number {
  const [y, m, d] = doc.date.split("-").map(Number);
  const issuedUTC = Date.UTC(y, m - 1, d);
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((todayUTC - issuedUTC) / 86400000));
}

export function bucketIndex(days: number): 0 | 1 | 2 | 3 {
  if (days <= 30) return 0;
  if (days <= 60) return 1;
  if (days <= 90) return 2;
  return 3;
}

/** A document that is still waiting for money. */
export function isOpenReceivable(d: InvoiceDocument): boolean {
  return (
    d.status === "sent" &&
    (d.type === "quote" || d.type === "proforma" || d.type === "tax_invoice")
  );
}

export function computeAging(
  documents: InvoiceDocument[],
  clients: Client[],
): { rows: AgingRow[]; totals: AgingTotals } {
  const byClient = new Map<string, AgingRow>();
  for (const d of documents) {
    if (!isOpenReceivable(d)) continue;
    const b = bucketIndex(daysOverdue(d));
    // Same attribution rule as the client pages: an unlinked document
    // (client_id null) is grouped under the one saved client it names,
    // otherwise under its normalized free-text name.
    const resolvedId = resolveDocumentClientId(d, clients);
    const key = resolvedId || `__no_client__:${normalizeName(d.clientName)}`;
    let row = byClient.get(key);
    if (!row) {
      row = {
        clientId: resolvedId || d.clientId,
        clientName: d.clientName,
        buckets: [0, 0, 0, 0],
        total: 0,
        docs: [],
      };
      byClient.set(key, row);
    }
    const amount = d.totalIls ?? d.total;
    row.buckets[b] += amount;
    row.total += amount;
    row.docs.push(d);
  }
  const rows = Array.from(byClient.values()).sort((a, b) => b.total - a.total);
  const totals: AgingTotals = { buckets: [0, 0, 0, 0], grand: 0, docCount: 0 };
  for (const r of rows) {
    for (let i = 0; i < 4; i++) totals.buckets[i] += r.buckets[i];
    totals.grand += r.total;
    totals.docCount += r.docs.length;
  }
  return { rows, totals };
}

import type { Client, InvoiceDocument } from "./types";
import { normalizeName, resolveDocumentClientId } from "./client-picker";
import { round2 } from "./vat";

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
  /** What is still open on each document, by id: its total net of the credit notes issued against it. */
  openAmounts: Record<string, number>;
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

/**
 * A document that is still waiting for money: an unpaid tax invoice or
 * proforma that was not converted into a successor. A price quote is an
 * offer, not a debt (the cash-flow forecast lists quotes as potential and
 * never counts them), so it was wrongly part of "פתוח לגבייה" before.
 */
export function isOpenReceivable(d: InvoiceDocument): boolean {
  return (
    d.status === "sent" &&
    !d.convertedToId &&
    (d.type === "proforma" || d.type === "tax_invoice")
  );
}

/**
 * Credit notes netted per original document, the same rule as the cash-flow
 * forecast: credit notes are stored ALREADY NEGATIVE, so they are added, and
 * only a credit note that names its original reduces a debt (a credit note
 * has no "settled" state, so a free-standing one would linger forever).
 */
export function creditsByOriginal(documents: InvoiceDocument[]): Map<string, number> {
  const credits = new Map<string, number>();
  for (const d of documents) {
    if (d.type !== "credit_note") continue;
    if (d.status === "draft" || d.status === "cancelled") continue;
    if (!d.originalDocumentId) continue;
    credits.set(d.originalDocumentId, (credits.get(d.originalDocumentId) ?? 0) + (d.totalIls ?? d.total));
  }
  return credits;
}

/** One line of a client's account (כרטסת): a document and what it adds, in shekels. */
export interface ClientAccountRow {
  doc: InvoiceDocument;
  /** `totalIls ?? total`; negative for a credit note. */
  amount: number;
}

export interface ClientAccount {
  rows: ClientAccountRow[];
  billed: number;
  paid: number;
  /** billed - paid, which is exactly what computeAging reports as open for these documents. */
  balance: number;
}

/**
 * Whether a document is a line of a client's account: an issued, not
 * converted receipt / tax invoice / tax invoice-receipt / proforma, or a
 * credit note. A price quote is an offer, not a charge, and a converted
 * document is represented by its successor (a proforma converted into a
 * tax invoice-receipt counted both, doubling billed and paid).
 */
export function isClientAccountDocument(d: InvoiceDocument): boolean {
  if (d.status === "draft" || d.status === "cancelled") return false;
  if (d.convertedToId) return false;
  return (
    d.type === "receipt" ||
    d.type === "tax_invoice" ||
    d.type === "tax_invoice_receipt" ||
    d.type === "proforma" ||
    d.type === "credit_note"
  );
}

/**
 * Billed / paid / balance over ONE client's documents (pass the output of
 * documentsForClient), on the same receivable rule as computeAging so the
 * client card, the statement, the portal and "פתוח לגבייה" agree:
 *
 * - billed: every account document, credit notes (stored negative) included.
 * - paid: documents marked paid. A credit note that reduces an open
 *   receivable lowers the debt; any other credit (against a paid document,
 *   naming no original, or beyond what was still open) is a refund of money
 *   already received, so it lowers paid instead. That keeps
 *   balance = billed - paid = the aging open amount.
 */
export function computeClientAccount(documents: InvoiceDocument[]): ClientAccount {
  const rows = documents
    .filter(isClientAccountDocument)
    .map((doc) => ({ doc, amount: doc.totalIls ?? doc.total }));
  const credits = creditsByOriginal(documents);
  let billed = 0;
  let paid = 0;
  let creditTotal = 0;
  let creditAbsorbedByDebt = 0;
  for (const { doc, amount } of rows) {
    billed += amount;
    if (doc.type === "credit_note") {
      creditTotal += amount;
      continue;
    }
    if (doc.status === "paid") paid += amount;
    if (isOpenReceivable(doc)) {
      const credit = credits.get(doc.id) ?? 0;
      // A credit note can lower this debt to zero, never below.
      creditAbsorbedByDebt += Math.max(credit, -amount);
    }
  }
  // Credits (negative) that did not reduce an open debt were refunds.
  paid += creditTotal - creditAbsorbedByDebt;
  billed = round2(billed);
  paid = round2(paid);
  return { rows, billed, paid, balance: round2(billed - paid) };
}

export function computeAging(
  documents: InvoiceDocument[],
  clients: Client[],
): { rows: AgingRow[]; totals: AgingTotals } {
  const byClient = new Map<string, AgingRow>();
  const credits = creditsByOriginal(documents);
  for (const d of documents) {
    if (!isOpenReceivable(d)) continue;
    // Credited in part: only the rest is owed. Credited in full: nothing is.
    const amount = round2(Math.max(0, (d.totalIls ?? d.total) + (credits.get(d.id) ?? 0)));
    if (amount <= 0) continue;
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
        openAmounts: {},
      };
      byClient.set(key, row);
    }
    row.buckets[b] += amount;
    row.total += amount;
    row.docs.push(d);
    row.openAmounts[d.id] = amount;
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

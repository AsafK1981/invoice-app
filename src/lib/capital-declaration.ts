import { REVENUE_DOCUMENT_TYPES, type InvoiceDocument } from "./types";
import { toIsraelDate } from "./date";
import { round2 } from "./vat";

export interface OpenReceivablesResult {
  /** Sum of what was still open on each document at asOfDate (see openAmounts), ₪. */
  total: number;
  count: number;
  /** The documents open at asOfDate, oldest first. */
  docs: InvoiceDocument[];
  /** What was open on each listed document, by id: its shekel total net of the credit notes against it. */
  openAmounts: Record<string, number>;
}

/** The Israeli calendar day a payment was recorded on (paid_at is a UTC instant, or a bare date on some imports). */
function paidOnDate(paidAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) return paidAt;
  const at = new Date(paidAt);
  return Number.isNaN(at.getTime()) ? paidAt.slice(0, 10) : toIsraelDate(at);
}

/**
 * Whether an issued document was still unpaid at the END of asOfDate, judged
 * by when it was paid rather than by its status today: an invoice issued in
 * December 2025 and paid in January 2026 was a receivable on 31.12.2025.
 * Converting a document into its receipt marks it paid with paid_at = the
 * conversion, so a converted source is handled by the same test.
 *
 * Old documents can be "paid" with no paid_at (only the bank import stamped
 * it before the status button did). We cannot tell when those were paid, so
 * they are treated as paid BEFORE asOfDate, which keeps them out of the
 * receivables rather than inventing a debt that was probably settled.
 */
function wasOpenAt(d: InvoiceDocument, asOfDate: string): boolean {
  if (d.status === "sent") return true;
  if (d.status !== "paid" || !d.paidAt) return false;
  return paidOnDate(d.paidAt) > asOfDate;
}

/**
 * Open receivables (חייבים) as of a given date: money already invoiced to
 * clients that had not been paid by then. This is one line item on a
 * הצהרת הון (capital declaration) - it is NOT the whole asset side, just the
 * slice this app actually has data for.
 *
 * Only revenue documents (receipt / tax invoice / tax invoice-receipt) can
 * be receivables: quotes and proformas are not legal invoices and create no
 * enforceable claim.
 *
 * Credit notes (stored negative) are never receivables themselves: a credit
 * note has no "paid" state, so counting it as open made every refund ever
 * issued a negative receivable (a paid 10,000 invoice with a 2,000 refund
 * gave -2,000). One issued by asOfDate reduces only the document it names,
 * and only while that document is open, down to zero and never below.
 *
 * `asOfDate` is inclusive: a document dated exactly on asOfDate counts.
 */
export function computeOpenReceivables(
  documents: InvoiceDocument[],
  asOfDate: string,
): OpenReceivablesResult {
  const credits = new Map<string, number>();
  for (const d of documents) {
    if (d.type !== "credit_note" || !d.originalDocumentId) continue;
    if (d.status === "draft" || d.status === "cancelled" || d.date > asOfDate) continue;
    credits.set(d.originalDocumentId, (credits.get(d.originalDocumentId) ?? 0) + (d.totalIls ?? d.total));
  }

  const docs: InvoiceDocument[] = [];
  const openAmounts: Record<string, number> = {};
  let total = 0;
  const candidates = documents
    .filter((d) => REVENUE_DOCUMENT_TYPES.includes(d.type) && d.date <= asOfDate && wasOpenAt(d, asOfDate))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const d of candidates) {
    const amount = round2(Math.max(0, (d.totalIls ?? d.total) + (credits.get(d.id) ?? 0)));
    if (amount <= 0) continue;
    docs.push(d);
    openAmounts[d.id] = amount;
    total += amount;
  }

  return { total: round2(total), count: docs.length, docs, openAmounts };
}

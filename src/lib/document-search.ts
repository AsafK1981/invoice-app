import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type InvoiceDocument,
} from "./types";
import { formatCurrency, formatDate } from "./format";

/**
 * Builds a searchable string covering every field a user might want to
 * search by: number (#1023 / 1023), type ("חשבונית מס"), status ("שולם"),
 * client name, subject, notes, date (raw + formatted), total amount in
 * multiple representations, payment method, and every item description.
 */
function buildHaystack(doc: InvoiceDocument): string {
  const totalAbs = Math.abs(doc.total);
  return [
    `#${doc.number}`,
    String(doc.number),
    DOCUMENT_TYPE_LABELS[doc.type],
    DOCUMENT_STATUS_LABELS[doc.status],
    doc.clientName,
    doc.subject || "",
    doc.notes || "",
    doc.date,
    formatDate(doc.date),
    String(doc.total),
    String(totalAbs),
    String(Math.round(totalAbs)),
    formatCurrency(doc.total),
    doc.paymentMethod ? PAYMENT_METHOD_LABELS[doc.paymentMethod] : "",
    ...doc.items.map((i) => i.description),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Match a document against a search query. Multi-term queries match all
 * terms (AND), so "טים 1500" finds docs for "טים טדי" worth ~₪1500.
 */
export function matchDocument(doc: InvoiceDocument, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = buildHaystack(doc);
  return terms.every((t) => haystack.includes(t));
}

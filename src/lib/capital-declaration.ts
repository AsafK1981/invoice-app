import { isCountableRevenue, type InvoiceDocument } from "./types";

export interface OpenReceivablesResult {
  /** Sum of totalIls ?? total across the open documents, ₪. */
  total: number;
  count: number;
  /** The matching documents, oldest first. */
  docs: InvoiceDocument[];
}

/**
 * Open receivables (חייבים) as of a given date: money already invoiced to
 * clients that has not been marked paid yet. This is one line item on a
 * הצהרת הון (capital declaration) - it is NOT the whole asset side, just the
 * slice this app actually has data for.
 *
 * Only documents that would count as revenue once paid are included (see
 * isCountableRevenue): quotes and proformas are excluded because they are
 * not legal invoices and create no enforceable claim, and a document that
 * was converted into a successor (convertedToId set) is excluded so it
 * isn't counted twice. Credit notes ARE included and are stored negative,
 * so an open (unpaid) credit note correctly nets down what a client still
 * owes rather than being double-subtracted.
 *
 * `asOfDate` is inclusive: a document dated exactly on asOfDate counts.
 * Documents issued after asOfDate are excluded, since receivables are a
 * snapshot at a point in time, not "everything currently open".
 */
export function computeOpenReceivables(
  documents: InvoiceDocument[],
  asOfDate: string,
): OpenReceivablesResult {
  const open = documents
    .filter((d) => d.status === "sent" && isCountableRevenue(d) && d.date <= asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    total: open.reduce((sum, d) => sum + (d.totalIls ?? d.total), 0),
    count: open.length,
    docs: open,
  };
}

import type { InvoiceDocument } from "./types";
import { creditsByOriginal } from "./aging";

/**
 * A conversion whose successor was fully reversed by credit notes.
 *
 * Document A is converted into document B and locked, so the same work cannot
 * be billed twice. When B is then fully credited, A stays locked, and without
 * an explanation on A that looks like a bug.
 *
 * A is deliberately NOT reopened. Reopening it would put it back into the
 * client account, the aging report, the cash-flow forecast and the dunning
 * pass at its full amount, because credit notes are keyed to the document they
 * name (B) and nothing can ever net them against A. The client portal reads
 * the same account rule, so the customer who was just refunded would be shown
 * a balance they do not owe and then emailed a demand for it. Verified on
 * 2026-09-16: releasing a credited proforma moves computeClientAccount from
 * balance 0 to balance 1000. The owner re-bills by duplicating instead, which
 * touches no state at all.
 *
 * Reachability, for whoever reads this next: conversion allows quote/proforma
 * -> receipt | tax_invoice_receipt and tax_invoice -> receipt, while a credit
 * note may only name a tax_invoice or a tax_invoice_receipt. So the only
 * successors that can be credited are tax_invoice_receipt ones, which means
 * the source is always a quote or a proforma.
 */
export type ReversedConversion = {
  successor: InvoiceDocument;
  /** Credit notes that name the successor, newest first. Stored negative. */
  credits: InvoiceDocument[];
  /** Positive amount credited so far, in the successor's reporting currency. */
  credited: number;
  /** The successor's own total, the bar `credited` had to clear. */
  total: number;
};

/** Cent tolerance: a credit note issued on another day carries its own rate. */
const TOLERANCE = 0.01;

const amountOf = (d: InvoiceDocument) => d.totalIls ?? d.total;

/**
 * The reversal behind a locked source document, or null when there is none:
 * the document was never converted, its successor is not in `documents`, or
 * the credit notes do not cover the successor in full. A partial credit
 * reports nothing, because the deal is not undone.
 */
export function reversedConversion(
  doc: InvoiceDocument,
  documents: InvoiceDocument[],
): ReversedConversion | null {
  if (!doc.convertedToId) return null;
  const successor = documents.find((d) => d.id === doc.convertedToId);
  if (!successor) return null;

  // Same credit rule as the aging report and the client account: credit notes
  // are stored negative, and a draft or cancelled one does not count.
  const credited = -(creditsByOriginal(documents).get(successor.id) ?? 0);
  const total = amountOf(successor);
  if (credited <= 0 || total <= 0) return null;
  if (credited + TOLERANCE < total) return null;

  const credits = documents
    .filter((d) => d.type === "credit_note" && d.originalDocumentId === successor.id)
    .filter((d) => d.status !== "draft" && d.status !== "cancelled")
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return { successor, credits, credited, total };
}

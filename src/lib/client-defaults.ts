import type { InvoiceDocument, PaymentMethod } from "./types";

export interface ClientDefaults {
  paymentMethod?: PaymentMethod;
  recentSubject?: string;
  documentCount: number;
  averageTotal?: number;
}

/**
 * Look at a client's past documents and figure out what to prefill on a fresh
 * editor session. Picks the most-recent values where they exist, and reports
 * a count + average so the UI can show "this client usually pays X" hints.
 */
export function getClientDefaults(
  clientId: string,
  documents: InvoiceDocument[]
): ClientDefaults {
  if (!clientId) return { documentCount: 0 };

  const clientDocs = documents
    .filter((d) => d.clientId === clientId && d.status !== "cancelled")
    .sort((a, b) => b.date.localeCompare(a.date));

  if (clientDocs.length === 0) return { documentCount: 0 };

  // Most-recent non-empty values
  const recentPaymentMethod = clientDocs.find((d) => d.paymentMethod)?.paymentMethod;
  const recentSubject = clientDocs.find((d) => d.subject?.trim())?.subject?.trim();

  const totals = clientDocs.map((d) => Math.abs(d.total)).filter((t) => t > 0);
  const averageTotal =
    totals.length > 0 ? totals.reduce((s, t) => s + t, 0) / totals.length : undefined;

  return {
    paymentMethod: recentPaymentMethod,
    recentSubject,
    documentCount: clientDocs.length,
    averageTotal,
  };
}

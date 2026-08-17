import { documentsForClient } from "./client-picker";
import type { Client, InvoiceDocument, PaymentMethod } from "./types";

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
  client: Pick<Client, "id" | "name" | "taxId"> | null | undefined,
  documents: InvoiceDocument[],
  allClients: Pick<Client, "id" | "name" | "taxId">[]
): ClientDefaults {
  if (!client) return { documentCount: 0 };

  // documentsForClient also claims unlinked documents (client_id null) that
  // name this customer (and only this customer), so the "היסטוריה: N מסמכים"
  // hint agrees with the documents list.
  const clientDocs = documentsForClient(documents, client, allClients)
    .filter((d) => d.status !== "cancelled")
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

// C100 1215: the customer's dealer number on a document. One decision shared
// by records.ts (what the file carries) and the preflight (what it reports).
import { normalizeBusinessNumber } from "../israeli-id";
import type { Client, InvoiceDocument } from "../types";

/**
 * documents.client_tax_id was added by
 * scripts/migrations/20260625-document-client-tax-id.sql without a backfill,
 * so only documents dated before it may lack the snapshot legitimately.
 */
export const CLIENT_TAX_ID_SNAPSHOT_SINCE = "2026-06-25";

export interface UniformCustomerVat {
  /** The padded 9-digit number, or "" (written as zeros). */
  value: string;
  /** What the number was read from, before normalizing. */
  raw: string;
  /** True when the linked client's current number stood in for a missing snapshot. */
  fallback: boolean;
  /** True when a number exists but the normalizer refuses it (a foreign id). */
  refused: boolean;
}

export function uniformCustomerVat(doc: Pick<InvoiceDocument, "clientTaxId" | "date">, client: Pick<Client, "taxId"> | null | undefined): UniformCustomerVat {
  const snapshot = String(doc.clientTaxId ?? "").trim();
  const useClient = !snapshot && String(doc.date ?? "") < CLIENT_TAX_ID_SNAPSHOT_SINCE && Boolean(String(client?.taxId ?? "").trim());
  const raw = useClient ? String(client?.taxId ?? "").trim() : snapshot;
  const value = normalizeBusinessNumber(raw).value ?? "";
  return { value, raw, fallback: useClient, refused: raw !== "" && value === "" };
}

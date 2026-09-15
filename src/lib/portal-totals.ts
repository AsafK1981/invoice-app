import type { DocumentType, InvoiceDocument } from "./types";
import { computeClientAccount } from "./aging";

/** The document fields /api/portal/documents returns that the totals read. */
export interface PortalTotalsDoc {
  id: string;
  type: string;
  status: string;
  total: number;
  total_ils?: number | null;
  /** True when the document was converted into a successor (which is listed and counted instead). */
  converted?: boolean;
  /** For a credit note: the document it credits, only when that document is in the same list. */
  original_document_id?: string | null;
}

/**
 * "שולמו" / "ממתין לתשלום" in the client portal, on the same account rule as
 * the business's own client card and statement (computeClientAccount): an
 * open quote is not money owed, a converted proforma is not counted next to
 * its invoice-receipt, and a credit note nets the debt it names.
 */
export function portalTotals(docs: PortalTotalsDoc[]): { paid: number; open: number } {
  const mapped = docs.map((d) => ({
    id: d.id,
    type: d.type as DocumentType,
    number: 0,
    date: "",
    clientId: "",
    clientName: "",
    status: d.status as InvoiceDocument["status"],
    items: [],
    subtotal: 0,
    vat: 0,
    total: Number(d.total) || 0,
    totalIls: d.total_ils != null ? Number(d.total_ils) : undefined,
    convertedToId: d.converted ? "converted" : undefined,
    originalDocumentId: d.original_document_id || undefined,
  })) satisfies InvoiceDocument[];
  const account = computeClientAccount(mapped);
  return { paid: account.paid, open: account.balance };
}

// The D110 lines a document contributes. An issued document stored without
// line items (imported, or created before items were required) still needs a
// detail line for its header: one line is written from the document itself,
// so the file stays whole instead of the export being blocked.
import { DOCUMENT_TYPE_LABELS, type DocumentItem, type InvoiceDocument } from "../types";

export interface UniformDocumentLines {
  items: DocumentItem[];
  /** True when the one line was built from the document, not stored. */
  synthesized: boolean;
}

export function uniformDocumentLines(doc: InvoiceDocument): UniformDocumentLines {
  // A plain receipt carries D120 payment rows only (see builder.ts).
  if (doc.items.length > 0 || doc.type === "receipt") return { items: doc.items, synthesized: false };
  const amount = doc.subtotal + (doc.discountAmount ?? 0);
  return {
    items: [{ id: `${doc.id}-document-line`, description: doc.subject?.trim() || DOCUMENT_TYPE_LABELS[doc.type], quantity: 1, unitPrice: amount, total: amount }],
    synthesized: true,
  };
}

/** VAT percent of the document for field 1268 (9(2)v99), e.g. 18 for 18%. */
export function documentVatPercent(doc: Pick<InvoiceDocument, "subtotal" | "vat">): number {
  if (!doc.subtotal || !Number.isFinite(doc.vat / doc.subtotal)) return 0;
  return Math.round((doc.vat / doc.subtotal) * 10000) / 100;
}

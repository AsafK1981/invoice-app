// Pure row mappers for the מבנה אחיד export. Shared by the export route and
// the nightly guard, so both check exactly the same values. No Supabase here.
import type { Business, Client, DocumentItem, Expense, InvoiceDocument } from "../types";

type Row = Record<string, unknown>;

const numeric = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
const optionalNumber = (value: unknown) => (value == null ? undefined : numeric(value));
const optionalText = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const text = (value: unknown) => (typeof value === "string" ? value : "");

export function mapUniformBusiness(row: Row): Business {
  return {
    id: String(row.id),
    name: text(row.name),
    businessType: row.business_type as Business["businessType"],
    taxId: text(row.tax_id),
    address: text(row.address),
    phone: optionalText(row.phone),
    email: optionalText(row.email),
  };
}

/** Items grouped per document, in their stored order. */
export function groupUniformItems(rows: readonly Row[]): Map<string, DocumentItem[]> {
  const byDoc = new Map<string, DocumentItem[]>();
  for (const row of [...rows].sort((a, b) => Number(a.sort_order) - Number(b.sort_order))) {
    const documentId = String(row.document_id);
    if (!byDoc.has(documentId)) byDoc.set(documentId, []);
    byDoc.get(documentId)!.push({
      id: String(row.id),
      productId: optionalText(row.product_id),
      description: text(row.description),
      quantity: numeric(row.quantity),
      unitPrice: numeric(row.unit_price),
      total: numeric(row.total),
    });
  }
  return byDoc;
}

export function mapUniformClient(row: Row): Client {
  return {
    id: String(row.id),
    name: text(row.name),
    taxId: optionalText(row.tax_id),
    address: optionalText(row.address),
    phone: optionalText(row.phone),
    email: optionalText(row.email),
    createdAt: text(row.created_at).slice(0, 10),
  };
}

export function mapUniformDocument(row: Row, items: DocumentItem[]): InvoiceDocument {
  return {
    id: String(row.id),
    type: row.type as InvoiceDocument["type"],
    number: numeric(row.number),
    date: text(row.date),
    clientId: text(row.client_id),
    clientName: text(row.client_name),
    clientTaxId: optionalText(row.client_tax_id),
    subject: optionalText(row.subject),
    status: (row.status as InvoiceDocument["status"]) || "draft",
    items,
    subtotal: numeric(row.subtotal),
    vat: numeric(row.vat),
    total: numeric(row.total),
    // Shekel snapshots stay undefined when missing: the preflight blocks them,
    // nothing falls back to native amounts.
    currency: optionalText(row.currency),
    exchangeRate: optionalNumber(row.exchange_rate),
    subtotalIls: optionalNumber(row.subtotal_ils),
    vatIls: optionalNumber(row.vat_ils),
    totalIls: optionalNumber(row.total_ils),
    rounding: row.rounding == null ? 0 : numeric(row.rounding),
    discountAmount: optionalNumber(row.discount_amount),
    withholdingAmount: optionalNumber(row.withholding_amount),
    convertedToId: optionalText(row.converted_to_id),
    paymentDetails: row.payment_details as InvoiceDocument["paymentDetails"],
    paymentMethod: (row.payment_method as InvoiceDocument["paymentMethod"]) || undefined,
    notes: optionalText(row.notes),
    allocationNumber: optionalText(row.allocation_number),
    importBatchId: optionalText(row.import_batch_id),
    zeroRated: row.zero_rated === true,
  };
}

export function mapUniformExpense(row: Row): Expense {
  return {
    id: String(row.id),
    date: text(row.date),
    category: text(row.category),
    supplier: text(row.supplier),
    amount: numeric(row.amount),
    description: optionalText(row.description),
    vatAmount: row.vat_amount != null ? Number(row.vat_amount) : 0,
  };
}

// Columns and pure row mappers for the filing reports (PCN874 on /reports/vat,
// invoices-period, expenses). Shared by the browser hook and the nightly
// guard script, so both judge exactly the same rows.
import { mapProfitLossDocument, mapProfitLossExpense } from "./profit-loss-rows";
import type { Expense, InvoiceDocument } from "./types";

export const FILING_COLUMNS = {
  documents: "id,date,type,status,number,client_id,client_name,client_tax_id,subtotal,vat,total,currency,exchange_rate,subtotal_ils,vat_ils,total_ils,converted_to_id,allocation_number,zero_rated,rounding,withholding_amount,import_batch_id",
  expenses: "id,date,category,supplier,description,amount,vat_amount,is_equipment,supplier_tax_id,reference,allocation_number",
} as const;

const numeric = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
const text = (value: unknown) => typeof value === "string" ? value : "";

export function mapFilingDocument(row: Record<string, unknown>): InvoiceDocument {
  return {
    ...mapProfitLossDocument(row), number: numeric(row.number), clientId: text(row.client_id),
    clientName: text(row.client_name), clientTaxId: text(row.client_tax_id), items: [],
    subtotal: numeric(row.subtotal), subtotalIls: row.subtotal_ils == null ? undefined : numeric(row.subtotal_ils),
    allocationNumber: text(row.allocation_number), zeroRated: row.zero_rated === true,
    rounding: row.rounding == null ? 0 : numeric(row.rounding),
    // מקדמות offset withholding at source; the same column the document store maps.
    withholdingAmount: row.withholding_amount == null ? undefined : numeric(row.withholding_amount),
    importBatchId: typeof row.import_batch_id === "string" && row.import_batch_id ? row.import_batch_id : undefined,
  };
}

export function mapFilingExpense(row: Record<string, unknown>): Expense {
  return { ...mapProfitLossExpense(row), supplier: text(row.supplier), description: text(row.description), supplierTaxId: text(row.supplier_tax_id), reference: text(row.reference), allocationNumber: text(row.allocation_number) };
}

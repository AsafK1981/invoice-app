// Pure row mappers for the profit-loss and filing reports. No Supabase client
// here on purpose: node scripts (the nightly filing guard) import these.
import type { ProfitLossDocument, ProfitLossExpense } from "./profit-loss";

const number = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
const optionalNumber = (value: unknown) => value == null ? undefined : number(value);
export function mapProfitLossDocument(row: Record<string, unknown>): ProfitLossDocument {
  if (!["receipt", "tax_invoice", "tax_invoice_receipt", "credit_note", "quote", "proforma"].includes(String(row.type)) || !["draft", "sent", "paid", "cancelled"].includes(String(row.status))) throw new Error("נמצא סוג מסמך או סטטוס לא תקין. לא ניתן להפיק דוח מלא.");
  return { id: String(row.id), date: typeof row.date === "string" ? row.date : "", type: row.type as ProfitLossDocument["type"], status: row.status as ProfitLossDocument["status"], total: number(row.total), vat: number(row.vat), currency: row.currency == null ? undefined : String(row.currency), exchangeRate: optionalNumber(row.exchange_rate), totalIls: optionalNumber(row.total_ils), vatIls: optionalNumber(row.vat_ils), convertedToId: typeof row.converted_to_id === "string" ? row.converted_to_id : undefined };
}
export function mapProfitLossExpense(row: Record<string, unknown>): ProfitLossExpense {
  if (row.is_equipment != null && typeof row.is_equipment !== "boolean") throw new Error("סיווג ציוד לא תקין. לא ניתן להפיק דוח מלא.");
  return { id: String(row.id), date: typeof row.date === "string" ? row.date : "", category: typeof row.category === "string" ? row.category : "", amount: number(row.amount), vatAmount: optionalNumber(row.vat_amount), isEquipment: row.is_equipment === true };
}

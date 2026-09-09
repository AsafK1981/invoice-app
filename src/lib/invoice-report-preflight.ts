import type { InvoiceDocument } from "./types";
import { validPcnDate } from "./ita/pcn874";
import { isValidIsraeliIdNumber } from "./israeli-id";

export interface ReportIssue { level: "error" | "warning"; message: string; href?: string; sourceLabel?: string }
export const invoiceReportTypes = ["tax_invoice", "tax_invoice_receipt", "credit_note"];

/** Integrity checks for an accountant's listing, not a statutory upload format. */
export function invoiceReportPreflight(documents: InvoiceDocument[], start: string, end: string): ReportIssue[] {
  const issues: ReportIssue[] = [];
  if (!validPcnDate(start) || !validPcnDate(end) || start > end) {
    return [{ level: "error", message: "יש לבחור תאריך התחלה וסיום תקינים, כשהסיום אינו קודם להתחלה." }];
  }
  const seen = new Set<string>();
  for (const doc of documents) {
    if (!invoiceReportTypes.includes(doc.type) || doc.status === "draft" || doc.status === "cancelled") continue;
    const add = (level: ReportIssue["level"], message: string) => issues.push({ level, message, href: `/documents/${doc.id}`, sourceLabel: `מסמך ${doc.number}` });
    if (!validPcnDate(doc.date)) { add("error", "תאריך המסמך חסר או לא תקין. לא ניתן לשייך אותו לתקופת הדוח."); continue; }
    if (doc.date < start || doc.date > end) continue;
    if (!Number.isSafeInteger(doc.number) || doc.number <= 0) add("error", "מספר המסמך חסר או לא תקין.");
    const key = `${doc.type}:${doc.number}`;
    if (seen.has(key)) add("error", "נמצא מספר מסמך כפול באותו סוג מסמך. יש לבדוק את המסמכים לפני הייצוא.");
    seen.add(key);
    const foreign = !!doc.currency && doc.currency !== "ILS";
    if (foreign && ![doc.subtotalIls, doc.vatIls, doc.totalIls].every((value) => typeof value === "number" && Number.isFinite(value))) add("error", "חסרים סכומים שמורים בשקלים למסמך במטבע זר. לא ניתן לחשב דוח בשקלים.");
    const values = [doc.subtotalIls ?? doc.subtotal, doc.vatIls ?? doc.vat, doc.totalIls ?? doc.total];
    if (!values.every(Number.isFinite)) add("error", "סכום לפני מע״מ, מע״מ או סכום כולל חסר או אינו מספר תקין.");
    else {
      const originalRounding = doc.rounding ?? 0;
      const rounding = originalRounding === 0 ? 0 : originalRounding * (foreign ? (doc.exchangeRate && doc.exchangeRate > 0 ? doc.exchangeRate : NaN) : 1);
      if (!Number.isFinite(rounding) || Math.abs(values[0] + values[1] + rounding - values[2]) > 0.03) add("error", "הסכום לפני מע״מ בתוספת המע״מ והעיגול אינו תואם לסכום הכולל. יש לבדוק את המסמך.");
    }
    if (doc.clientTaxId && !isValidIsraeliIdNumber(doc.clientTaxId)) add("warning", "מספר הזיהוי של הלקוח אינו מספר ישראלי תקין. יש לבדוק אם זה לקוח מחו״ל או פרט שדורש תיקון.");
    if (!doc.clientName.trim()) add("warning", "חסר שם לקוח במסמך. מומלץ לבדוק לפני העברה לרואה החשבון.");
  }
  return issues;
}

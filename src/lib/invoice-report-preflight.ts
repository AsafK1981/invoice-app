import type { DocumentType, InvoiceDocument } from "./types";
import { DOCUMENT_TYPE_LABELS } from "./types";
import { validPcnDate } from "./ita/pcn874";
import { normalizeBusinessNumber } from "./israeli-id";

export const invoiceReportTypes: readonly DocumentType[] = ["tax_invoice", "tax_invoice_receipt", "credit_note"];

export type InvoiceListIssueCode =
  | "period_invalid"
  | "date_invalid"
  | "number_invalid"
  | "duplicate_number"
  | "foreign_currency_missing_ils"
  | "amount_invalid"
  | "total_mismatch"
  | "customer_number_not_israeli"
  | "client_name_missing";

/**
 * "error": the listing cannot be built (an unusable period).
 * "totals": the totals may be wrong or incomplete. Downloads stay allowed;
 * the panel shows it above the table, the file carries it as a note and the
 * total row is labelled partial.
 * "note": worth a look, collapsed.
 */
export type InvoiceListIssueLevel = "error" | "totals" | "note";

export interface InvoiceListIssue {
  code: InvoiceListIssueCode;
  level: InvoiceListIssueLevel;
  message: string;
  documentId?: string;
  sourceLabel?: string;
  /** The document's own customer number, for the inline fix. */
  current?: string;
  imported?: boolean;
}

export const INVOICE_LIST_TITLES: Record<InvoiceListIssueCode, string> = {
  period_invalid: "יש לבחור תקופה תקינה",
  date_invalid: "מסמך בלי תאריך תקין",
  number_invalid: "מספר מסמך חסר או לא תקין",
  duplicate_number: "מספר מסמך כפול",
  foreign_currency_missing_ils: "מסמך במטבע חוץ בלי סכומים בשקלים",
  amount_invalid: "סכום חסר או לא מספרי",
  total_mismatch: "הסכום הכולל לא תואם לסכום לפני מע״מ והמע״מ",
  customer_number_not_israeli: "מספר הלקוח אינו מספר עוסק ישראלי",
  client_name_missing: "חסר שם לקוח",
};

/** Integrity checks for an accountant's listing, not a statutory upload format. */
export function invoiceReportPreflight(documents: readonly InvoiceDocument[], start: string, end: string): InvoiceListIssue[] {
  if (!validPcnDate(start) || !validPcnDate(end) || start > end) {
    return [{ code: "period_invalid", level: "error", message: "יש לבחור תאריך התחלה וסיום תקינים, כשהסיום אינו קודם להתחלה." }];
  }
  const issues: InvoiceListIssue[] = [];
  const seen = new Set<string>();
  for (const doc of documents) {
    if (!invoiceReportTypes.includes(doc.type) || doc.status === "draft" || doc.status === "cancelled") continue;
    const add = (code: InvoiceListIssueCode, level: InvoiceListIssueLevel, message: string, extra: Partial<InvoiceListIssue> = {}) =>
      issues.push({ code, level, message, documentId: doc.id, sourceLabel: `${DOCUMENT_TYPE_LABELS[doc.type]} ${doc.number}`, imported: Boolean(doc.importBatchId), ...extra });
    if (!validPcnDate(doc.date)) {
      // Report a broken date only where the document could belong: the month it
      // names must overlap the period. Without a readable month it belongs to no
      // period, so it is a note instead of a "partial totals" finding everywhere.
      const month = /^(\d{4})-(0[1-9]|1[0-2])/.exec(String(doc.date ?? ""));
      if (!month) {
        add("date_invalid", "note", "תאריך המסמך חסר או לא קריא, ולכן המסמך לא מופיע באף תקופה בדוח. פתח את המסמך ובדוק את התאריך.");
      } else {
        const ym = `${month[1]}-${month[2]}`;
        if (ym >= start.slice(0, 7) && ym <= end.slice(0, 7))
          add("date_invalid", "totals", `תאריך המסמך בחודש ${ym} אינו תאריך תקין, ולכן המסמך לא נכלל בדוח. ייתכן שחסר מסמך בסכומים.`);
      }
      continue;
    }
    if (doc.date < start || doc.date > end) continue;
    if (!Number.isSafeInteger(doc.number) || doc.number <= 0) add("number_invalid", "note", "מספר המסמך חסר או לא תקין.");
    const key = `${doc.type}:${doc.number}`;
    if (seen.has(key)) add("duplicate_number", "totals", "נמצא מסמך נוסף מאותו סוג עם אותו מספר. בדוק שהמסמך לא נספר פעמיים בסכומים.");
    seen.add(key);
    const foreign = !!doc.currency && doc.currency !== "ILS";
    if (foreign && ![doc.subtotalIls, doc.vatIls, doc.totalIls].every((value) => typeof value === "number" && Number.isFinite(value))) {
      add("foreign_currency_missing_ils", "totals", "למסמך במטבע חוץ חסרים סכומים שמורים בשקלים, ולכן הוא לא נכלל בשורת הסיכום.");
    } else {
      const values = [doc.subtotalIls ?? doc.subtotal, doc.vatIls ?? doc.vat, doc.totalIls ?? doc.total];
      if (!values.every(Number.isFinite)) {
        add("amount_invalid", "totals", "סכום לפני מע״מ, מע״מ או סכום כולל חסר או לא מספרי, ולכן המסמך לא נכלל בשורת הסיכום.");
      } else {
        const originalRounding = doc.rounding ?? 0;
        const rounding = originalRounding === 0 ? 0 : originalRounding * (foreign ? (doc.exchangeRate && doc.exchangeRate > 0 ? doc.exchangeRate : NaN) : 1);
        if (!Number.isFinite(rounding) || Math.abs(values[0] + values[1] + rounding - values[2]) > 0.03)
          add("total_mismatch", "totals", "הסכום לפני מע״מ בתוספת המע״מ והעיגול אינו תואם לסכום הכולל, ולכן עמודות הסיכום לא יתאימו זו לזו.");
      }
    }
    if (doc.clientTaxId && !normalizeBusinessNumber(doc.clientTaxId).value)
      add("customer_number_not_israeli", "note", "מספר הזיהוי של הלקוח אינו מספר עוסק ישראלי תקין. אם זה לקוח מחו״ל אין צורך לעשות דבר.", { current: doc.clientTaxId });
    if (!doc.clientName.trim()) add("client_name_missing", "note", "חסר שם לקוח במסמך. מומלץ לבדוק לפני העברה לרואה החשבון.");
  }
  return issues;
}

/** Distinct codes that stop the listing or change its totals. The nightly guard counts these. */
export function invoiceListAffectingCodes(issues: readonly Pick<InvoiceListIssue, "code" | "level">[]): InvoiceListIssueCode[] {
  return [...new Set(issues.filter((issue) => issue.level !== "note").map((issue) => issue.code))];
}

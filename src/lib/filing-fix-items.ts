// The "what's left before the download" model for /reports/vat. Pure: takes
// the PCN874 result plus the rows it was built from and returns grouped items,
// each with the one control that fixes it. The panel only renders this.
import type { Expense, InvoiceDocument } from "./types";
import { referenceDigits, sourceVatIdForPcn, type Pcn874Result, type PcnIssueCode, type PcnWarning } from "./ita/pcn874";
import type { FilingReportKind } from "./support-link";
import type { InvoiceListIssueCode } from "./invoice-report-preflight";

/** Every code a filing panel can show. */
export type FixCode = PcnIssueCode | InvoiceListIssueCode;

export type FixControl =
  | { kind: "supplier_tax_id"; expenseIds: string[]; current: string }
  | { kind: "supplier_reference"; expenseId: string; current: string }
  | { kind: "expense_allocation"; expenseId: string; current: string }
  | { kind: "expense_date"; expenseId: string; current: string }
  | { kind: "business_tax_id"; current: string }
  | { kind: "customer_tax_id"; documentId: string; current: string }
  | { kind: "credit_note"; documentId: string }
  /** `report` names the report in the support message; omitted means PCN874. */
  | { kind: "support"; documentId?: string; code: FixCode; report?: FilingReportKind }
  | { kind: "open_expense"; expenseId: string }
  | { kind: "open_document"; documentId: string }
  | { kind: "open_client"; clientId: string }
  | { kind: "period" }
  | { kind: "settings" }
  | { kind: "none" };

export type FixTier = "blocking" | "action" | "note";

export interface FilingFixItem {
  key: string;
  tier: FixTier;
  code: FixCode;
  title: string;
  messages: string[];
  labels: string[];
  control: FixControl;
  excludedVat?: number;
}

export interface FilingFixModel {
  blocking: FilingFixItem[];
  actions: FilingFixItem[];
  notes: FilingFixItem[];
  /**
   * The selected period cannot be a PCN874 file at all (a year, for example).
   * The report's numbers are still valid for it; the panel then shows only
   * the friendly "choose a reporting period" item, not a list of row problems.
   */
  periodOnly: boolean;
}

export const FIX_TITLES: Record<PcnIssueCode, string> = {
  dealer_number_invalid: "מספר העוסק של העסק בהגדרות לא תקין",
  period_invalid: "תקופת הדיווח לא תקינה",
  period_not_whole_months: "יש לבחור חודשים מלאים",
  generation_date_invalid: "תאריך ההפקה לא תקין",
  exempt_business: "עוסק פטור אינו מגיש דיווח מפורט",
  period_length: "הקובץ המפורט מוגש לחודש אחד או לחודשיים",
  period_open: "התקופה עוד לא הסתיימה",
  field_overflow: "סכום גדול מדי לשדות הקובץ",
  file_structure: "הקובץ שנבנה לא עבר את בדיקת המבנה",
  date_invalid: "תאריך חסר או לא תקין",
  amount_invalid: "סכום חסר או לא תקין",
  expense_amount_invalid: "סכום ההוצאה או המע״מ לא תקינים",
  sign_mismatch: "סימני הסכום והמע״מ לא תואמים",
  type_sign_mismatch: "סימן הסכום לא תואם את סוג המסמך",
  zero_rated_with_vat: "מסמך בשיעור אפס שכולל מע״מ",
  foreign_currency_missing_ils: "חסרים סכומים בשקלים למסמך במטבע חוץ",
  customer_number_invalid: "מספר העוסק של הלקוח לא תקין",
  customer_number_missing: "חסר מספר עוסק של הלקוח",
  supplier_number_invalid: "מספר העוסק של הספק לא תקין",
  input_missing_supplier_details: "חסרים פרטי חשבונית הספק",
  refund_input_missing_supplier_details: "בדוח להחזר חסרים פרטי חשבונית הספק",
  reference_invalid: "מספר חשבונית הספק לא תקין",
  reference_multiple_groups: "באסמכתא יש כמה קבוצות ספרות",
  allocation_invalid: "מספר ההקצאה לא תקין",
  possible_duplicate: "ייתכן דיווח כפול",
  zero_vat_not_zero_rated: "מסמך מס בלי מע״מ שלא סומן בשיעור אפס",
  sale_allocation_missing: "מסמך מס מעל הסף בלי מספר הקצאה",
  supplier_allocation_missing: "מע״מ תשומות לא נכלל: חסר מספר הקצאה",
};

const PERIOD_CODES = new Set<PcnIssueCode>(["period_length", "period_not_whole_months", "period_invalid"]);
const PERIOD_FRIENDLY_MESSAGE =
  "הסכומים למעלה נכונים לתקופה שבחרת. את קובץ הדיווח המפורט מגישים לכל תקופת דיווח בנפרד, ולכן כדי להוריד אותו בחר תקופה דו-חודשית או חודשית.";

const CREDIT_NOTE_CODES = new Set<PcnIssueCode>(["sign_mismatch", "type_sign_mismatch", "zero_rated_with_vat"]);

/**
 * Layer 4. A document issued in this app is corrected with a credit note. An
 * imported one (another system's data) or one missing its shekel amounts is a
 * data fix, so it goes to support with the code only.
 */
export function documentRepairControl(doc: InvoiceDocument | undefined, documentId: string, code: PcnIssueCode): FixControl {
  const foreignWithoutIls = Boolean(doc?.currency && doc.currency !== "ILS") && (!Number.isFinite(doc?.subtotalIls) || !Number.isFinite(doc?.vatIls));
  if (!doc || doc.importBatchId || foreignWithoutIls || doc.type === "credit_note" || !CREDIT_NOTE_CODES.has(code)) {
    return { kind: "support", documentId, code };
  }
  return { kind: "credit_note", documentId };
}

/**
 * The PCN874 button's state. "updating" wins over everything: while an inline
 * save is in flight or the rows are being refetched, the file on screen is the
 * one from BEFORE the fix, so it is neither downloadable nor a verdict.
 */
export function filingDownloadGate(state: { fileReady: boolean; refreshing: boolean; savesInFlight: number }): "ready" | "updating" | "blocked" {
  if (state.refreshing || state.savesInFlight > 0) return "updating";
  return state.fileReady ? "ready" : "blocked";
}

export interface FixCollector {
  put(key: string, tier: FixTier, code: FixCode, control: FixControl, message: string, label?: string, excludedVat?: number): void;
  items(): FilingFixItem[];
}

/**
 * Items keyed by the fix. A second finding under the same key adds its
 * message and label, escalates the tier to blocking when it blocks, and merges
 * grouped supplier expenses. Shared by every filing report's panel model.
 */
export function createFixCollector(titleOf: (code: FixCode) => string): FixCollector {
  const items = new Map<string, FilingFixItem>();
  return {
    put(key, tier, code, control, message, label, excludedVat) {
      const existing = items.get(key);
      if (!existing) {
        items.set(key, { key, tier, code, title: titleOf(code), messages: [message], labels: label ? [label] : [], control, excludedVat });
        return;
      }
      if (tier === "blocking") existing.tier = "blocking";
      if (!existing.messages.includes(message)) existing.messages.push(message);
      if (label && !existing.labels.includes(label)) existing.labels.push(label);
      if (control.kind === "supplier_tax_id" && existing.control.kind === "supplier_tax_id") {
        for (const id of control.expenseIds) if (!existing.control.expenseIds.includes(id)) existing.control.expenseIds.push(id);
      }
    },
    items: () => [...items.values()],
  };
}

export function splitFixTiers(all: readonly FilingFixItem[]): FilingFixModel {
  return {
    blocking: all.filter((i) => i.tier === "blocking"),
    actions: all.filter((i) => i.tier === "action"),
    notes: all.filter((i) => i.tier === "note"),
    periodOnly: false,
  };
}

export function buildFilingFixModel(
  result: Pick<Pcn874Result, "blockers" | "warnings">,
  data: { business: { taxId: string }; documents: readonly InvoiceDocument[]; expenses: readonly Expense[] },
): FilingFixModel {
  const periodBlocker = result.blockers.find((b) => PERIOD_CODES.has(b.code));
  if (periodBlocker) {
    const item: FilingFixItem = {
      key: `blocker:${periodBlocker.code}`,
      tier: "blocking",
      code: periodBlocker.code,
      title: FIX_TITLES[periodBlocker.code],
      messages: [PERIOD_FRIENDLY_MESSAGE],
      labels: [],
      control: { kind: "period" },
    };
    return { blocking: [item], actions: [], notes: [], periodOnly: true };
  }

  const documents = new Map(data.documents.map((d) => [d.id, d]));
  const expenses = new Map(data.expenses.map((e) => [e.id, e]));
  const collector = createFixCollector((code) => FIX_TITLES[code as PcnIssueCode] ?? code);
  const put = collector.put;
  const suppliers = new Map<string, { name: string; hasNumber: boolean }>();

  /** There is no suppliers table: same number, or same name when the number is empty, is one supplier. */
  function supplierGroup(w: PcnWarning, tier: FixTier) {
    const e = expenses.get(w.sourceId);
    const rawNumber = String(e?.supplierTaxId ?? "").trim();
    const digits = rawNumber.replace(/\D/g, "");
    const name = String(e?.supplier ?? "").replace(/\s+/g, " ").trim();
    const key = `supplier_tax_id:${digits ? `id:${digits}` : name ? `name:${name.toLowerCase()}` : `row:${w.sourceId}`}`;
    const known = suppliers.get(key);
    suppliers.set(key, { name: known?.name || name || "ספק לא ידוע", hasNumber: Boolean(known?.hasNumber || rawNumber) });
    put(key, tier, w.code, { kind: "supplier_tax_id", expenseIds: [w.sourceId], current: rawNumber }, w.message, w.sourceLabel);
  }

  function addExpenseItem(w: PcnWarning, tier: FixTier) {
    const e = expenses.get(w.sourceId);
    switch (w.code) {
      case "supplier_number_invalid":
        supplierGroup(w, tier);
        return;
      case "input_missing_supplier_details":
      case "refund_input_missing_supplier_details":
        if (!e || !sourceVatIdForPcn(e.supplierTaxId)) supplierGroup(w, tier);
        if (!e || !referenceDigits(e.reference))
          put(`supplier_reference:${w.sourceId}`, tier, w.code, { kind: "supplier_reference", expenseId: w.sourceId, current: e?.reference ?? "" }, w.message, w.sourceLabel);
        return;
      case "reference_invalid":
        put(`supplier_reference:${w.sourceId}`, tier, w.code, { kind: "supplier_reference", expenseId: w.sourceId, current: e?.reference ?? "" }, w.message, w.sourceLabel);
        return;
      case "allocation_invalid":
      case "supplier_allocation_missing":
        put(`expense_allocation:${w.sourceId}`, tier, w.code, { kind: "expense_allocation", expenseId: w.sourceId, current: e?.allocationNumber ?? "" }, w.message, w.sourceLabel, w.excludedVat);
        return;
      case "date_invalid":
        put(`expense_date:${w.sourceId}`, tier, w.code, { kind: "expense_date", expenseId: w.sourceId, current: e?.date ?? "" }, w.message, w.sourceLabel);
        return;
      default:
        put(`${tier}:${w.code}:${w.sourceId}`, tier, w.code, { kind: "open_expense", expenseId: w.sourceId }, w.message, w.sourceLabel);
    }
  }

  function addDocumentItem(w: PcnWarning, tier: FixTier) {
    const d = documents.get(w.sourceId);
    switch (w.code) {
      case "customer_number_invalid":
      case "customer_number_missing":
        // The document's own client_tax_id, never the client record: that is
        // the client's number today, not the one on the issued document.
        put(`customer_tax_id:${w.sourceId}`, tier, w.code, { kind: "customer_tax_id", documentId: w.sourceId, current: d?.clientTaxId ?? "" }, w.message, w.sourceLabel);
        return;
      case "sign_mismatch":
      case "type_sign_mismatch":
      case "zero_rated_with_vat":
      case "foreign_currency_missing_ils":
      case "date_invalid":
      case "amount_invalid":
      case "reference_invalid":
      case "allocation_invalid": {
        const control = documentRepairControl(d, w.sourceId, w.code);
        put(`${control.kind}:${w.sourceId}`, tier, w.code, control, w.message, w.sourceLabel);
        return;
      }
      default:
        put(`${tier}:${w.code}:${w.sourceId}`, tier, w.code, { kind: "open_document", documentId: w.sourceId }, w.message, w.sourceLabel);
    }
  }

  for (const blocker of result.blockers) {
    const control: FixControl =
      blocker.code === "dealer_number_invalid" ? { kind: "business_tax_id", current: data.business.taxId }
      : blocker.code === "period_open" ? { kind: "period" }
      : blocker.code === "exempt_business" ? { kind: "settings" }
      : blocker.code === "file_structure" || blocker.code === "field_overflow" ? { kind: "support", code: blocker.code }
      : { kind: "none" };
    put(`blocker:${blocker.code}`, "blocking", blocker.code, control, blocker.message);
  }
  for (const w of result.warnings) {
    const tier: FixTier = w.level === "error" ? "blocking" : w.level === "action" ? "action" : "note";
    if (w.source === "expense") addExpenseItem(w, tier);
    else addDocumentItem(w, tier);
  }

  for (const item of collector.items()) {
    if (item.control.kind === "supplier_tax_id") {
      const s = suppliers.get(item.key)!;
      const count = item.control.expenseIds.length;
      item.title = `${s.hasNumber ? `מספר העוסק של ${s.name} לא תקין` : `חסר מספר עוסק ל-${s.name}`}${count > 1 ? ` (${count} הוצאות)` : ""}`;
    } else if (item.control.kind === "supplier_reference" && item.code !== "reference_invalid") {
      item.title = "חסר מספר חשבונית של הספק";
    }
  }

  const all = collector.items();
  // The byte-level self-check mostly repeats row problems (a missing number
  // becomes "record N has an invalid number"). Show it only when nothing
  // more specific is left; the download gate still counts it either way.
  const specific = all.filter((i) => i.tier === "blocking" && i.key !== "blocker:file_structure");
  return {
    blocking: all.filter((i) => i.tier === "blocking" && (i.key !== "blocker:file_structure" || specific.length === 0)),
    actions: all.filter((i) => i.tier === "action"),
    notes: all.filter((i) => i.tier === "note"),
    periodOnly: false,
  };
}

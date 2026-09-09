// PCN874 - the Tax Authority's "דיווח מפורט" file for the periodic VAT return.
//
// One fixed-width ASCII text file per reporting period, uploaded on the
// מע"מ site (דיווח מפורט, misim.gov.il) alongside the periodic return. All
// fields are digits, signs (+/-) and the record-type letter, so no Hebrew
// code page is involved (unlike מבנה אחיד). Every amount is whole shekels.
//
// Layout (verified 2026-09-03 against the production generator used by the
// open-source "accounter" bookkeeping stack and against the record
// vocabulary in the Hashavshevet 2026 and Rivhit PCN874 guides; the ITA's
// full layout PDF was not fetched. Error codes 201-206 were rechecked in
// the indexed ITA error-code document on 2026-09-08; see
// docs/research/2026-09-08-pcn874-validation.md). A real upload should go
// through the ITA simulator once - that is the only authoritative check:
//
//   Header  "O", 131 chars:
//     O(1) dealer VAT(9) period YYYYMM(6) report type "1"(1) file date YYYYMMDD(8)
//     taxable sales ±(12) VAT on taxable sales ±(10)
//     sales at a different rate ±(12) their VAT ±(10)   [always zero]
//     sales record count(9) zero-rated/exempt sales ±(12)
//     other-inputs VAT ±(10) equipment-inputs VAT ±(10) inputs record count(9)
//     total to pay/refund ±(12)
//   Transaction, 60 chars each:
//     type(1) counterparty VAT(9) invoice date YYYYMMDD(8) reference group(4)
//     reference number(9) VAT(9, unsigned) invoice sum before VAT ±(11)
//     allocation number(9, zeros when none)
//   Footer  "X" + dealer VAT(9), 10 chars.
//
// Record types (סוגי רשומה):
//   S עסקה רגילה, לקוח מזוהה          L ריכוז עסקאות ללקוחות לא מזוהים
//   M חשבונית עצמית (עסקה)            Y ייצוא
//   I לקוח רש"פ                        T תשומה רגילה
//   K קופה קטנה (ריכוז)                R רשימון יבוא
//   P ספק רש"פ                         H מסמך אחר על פי חוק
//   C חשבונית עצמית (תשומה)
// This app issues S / L / Y for sales and T / K for inputs; the rest exist
// in the type so a future importer can round-trip them.
//
// Reporting rules the classifier applies (רשות המסים, הנחיות לדיווח מפורט):
//   - A sale of 5,000 ₪ or more before VAT must name the customer's VAT
//     number (S). Smaller sales to customers without a number are summed
//     into one L record whose reference field carries the document count.
//   - An input whose VAT is under 300 ₪ may be summed into one K record
//     (reference = number of invoices). 300 ₪ and up needs the supplier's
//     VAT number and invoice number (T).
//   - A period that ends in a REFUND (input VAT above output VAT) may not
//     use the K record at all: every input is itemised (Rivhit PCN874
//     guide, "דוח להחזר"), so the ITA can audit what it is paying back.
//   - Zero-rated / export sales are ONLY the documents the user explicitly
//     marked as such (`zeroRated`). A tax invoice that merely has 0 VAT is
//     reported as taxable and flagged, never silently promoted to an export.
//   - Credit notes carry a "-" on the invoice sum; the VAT field stays
//     unsigned and the header nets it out.
//   - Since 2024 supplier invoices above the חשבונית ישראל threshold need a
//     מספר הקצאה for the input VAT to be recognised; the last 9 digits go in
//     the allocation field of the T record.

import type { Business, Expense, InvoiceDocument } from "../types";
import { formatDate } from "../format";
import { isValidIsraeliIdNumber } from "../israeli-id";
import {
  allocationRequiredThreshold,
  normalizeCustomerVatNumber,
} from "../tax-authority";

export type PcnEntryType = "S" | "L" | "M" | "Y" | "I" | "T" | "K" | "R" | "P" | "H" | "C";

export const PCN_ENTRY_LABELS: Record<PcnEntryType, string> = {
  S: "עסקה רגילה - לקוח מזוהה",
  L: "ריכוז עסקאות - לקוחות לא מזוהים",
  M: "חשבונית עצמית (עסקה)",
  Y: "ייצוא",
  I: "לקוח רש״פ",
  T: "תשומה רגילה",
  K: "קופה קטנה (ריכוז)",
  R: "רשימון יבוא",
  P: "ספק רש״פ",
  H: "מסמך אחר על פי חוק",
  C: "חשבונית עצמית (תשומה)",
};

/** Sales at or above this (before VAT) must identify the customer. */
export const IDENTIFIED_SALE_THRESHOLD = 5000;
/** Inputs whose VAT is below this may be summed into the K record. */
export const PETTY_CASH_VAT_THRESHOLD = 300;

export interface PcnTransaction {
  entryType: PcnEntryType;
  /** 9 digits. Zeros for unidentified / petty cash, 999999999 for export. */
  vatId: string;
  /** YYYYMMDD */
  invoiceDate: string;
  /** 4 digits, "0000" unless the software uses reference groups. */
  refGroup: string;
  /** 9 digits: invoice number, or the document count on L / K records. */
  refNumber: string;
  /** Whole shekels, never negative (the sign lives on invoiceSum). */
  totalVat: number;
  /** Whole shekels before VAT, negative on credit notes. */
  invoiceSum: number;
  /** 9 digits, zeros when the document carries no allocation number. */
  allocationNumber: string;
  /** Which app rows produced this record (for the on-screen preview). */
  sourceIds: string[];
}

export interface PcnHeader {
  dealerVatId: string;
  /** YYYYMM - for a bi-monthly filer, the second month of the period. */
  reportMonth: string;
  /** YYYYMMDD */
  generationDate: string;
  taxableSalesAmount: number;
  taxableSalesVat: number;
  salesRecordCount: number;
  zeroOrExemptSales: number;
  otherInputsVat: number;
  equipmentInputsVat: number;
  inputsCount: number;
  /** Positive = לתשלום, negative = להחזר. */
  totalVat: number;
}

export type PcnWarningLevel = "error" | "warning";

export interface PcnWarning {
  level: PcnWarningLevel;
  message: string;
  /** "document" rows link to /documents/<id>, "expense" rows to /expenses. */
  source: "document" | "expense";
  sourceId: string;
  sourceLabel: string;
}

/** The six figures the periodic return form (דוח תקופתי) asks for. */
export interface VatReturnFigures {
  taxableSales: number;
  outputVat: number;
  zeroOrExemptSales: number;
  equipmentInputVat: number;
  otherInputVat: number;
  /** Positive = לתשלום, negative = להחזר. */
  netDue: number;
}

export interface Pcn874Result {
  filename: string;
  /** CRLF-terminated lines, ASCII only. */
  content: string;
  header: PcnHeader;
  transactions: PcnTransaction[];
  /** Per-row problems; "error" ones the ITA is likely to reject. */
  warnings: PcnWarning[];
  /**
   * Whole-file reasons the file must not be handed over at all (dealer number
   * invalid, period not a filing period, period still open). Export requires
   * both no blockers and no warnings with level error.
   */
  blockers: string[];
  /** True when the period nets to a refund, so inputs were itemised (no K). */
  refundPeriod: boolean;
  figures: VatReturnFigures;
}

export interface BuildPcn874Args {
  business: Pick<Business, "taxId" | "businessType">;
  documents: InvoiceDocument[];
  expenses: Expense[];
  /** Inclusive ISO dates, e.g. "2026-01-01" / "2026-02-28". */
  range: { start: string; end: string };
  /** Defaults to now. Injected so tests are deterministic. */
  generatedOn?: Date;
}

// ── formatting helpers ──────────────────────────────────────────────

const digitsOnly = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/**
 * The invoice number inside a free-text supplier reference. Suppliers write
 * "A-7788", "INV/2026/000123", "חש' 4451": the running number is the LAST
 * digit run, so that is what goes into the 9-digit reference field the ITA
 * matches against the supplier's own S record. Concatenating every digit
 * ("2026" + "000123") would guarantee a mismatch.
 */
export function referenceDigits(reference: unknown): string {
  const runs = String(reference ?? "").match(/\d+/g);
  return runs && runs.length > 0 ? runs[runs.length - 1] : "";
}

/** Right-align digits with leading zeros; keeps the LAST `width` digits. */
export function fixedDigits(value: string | number, width: number): string {
  const d = digitsOnly(typeof value === "number" ? Math.trunc(Math.abs(value)) : value);
  return (`${"0".repeat(width)}${d}`).slice(-width);
}

/** "+" / "-" followed by `width` zero-padded digits of the magnitude. */
export function signedDigits(value: number, width: number): string {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${fixedDigits(Math.abs(value), width)}`;
}

/** Half-up to whole shekels on the magnitude, sign restored (never rounds a credit toward zero). */
export function roundShekel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.round(Math.abs(value) + Number.EPSILON);
  return value < 0 ? -magnitude : magnitude;
}

export function isoToYyyymmdd(iso: string): string {
  return fixedDigits(iso.slice(0, 10), 8);
}

export function isoDateInIsrael(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export function yyyymmddToday(d: Date): string {
  return isoDateInIsrael(d).replace(/-/g, "");
}

/** Whole calendar months covered by an inclusive ISO range (1 for a month, 2 for a bi-month, 12 for a year). */
export function monthsInRange(range: { start: string; end: string }): number {
  const [sy, sm] = range.start.split("-").map(Number);
  const [ey, em] = range.end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

/** ITA detailed-report error codes 201-206. Registry status requires an online check. */
export function validPcnVatId(value: string): boolean {
  return /^\d{9}$/.test(value) && isValidIsraeliIdNumber(value);
}

export function validPcnDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const validCompactDate = (v: string) => /^\d{8}$/.test(v) && validPcnDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`);
const withinField = (n: number, width: number) => Number.isFinite(n) && Math.abs(roundShekel(n)) < 10 ** width;
const allocationApplies = (date: string, net: number) => date >= "2024-05-05" && net > allocationRequiredThreshold(new Date(`${date}T12:00:00Z`));

/** Inspect original values before filtering dates or lossy numeric formatting. */
function validateSources(documents: InvoiceDocument[], expenses: Expense[], range: BuildPcn874Args["range"]): PcnWarning[] {
  const warnings: PcnWarning[] = [];
  const seen = new Set<string>();
  const check = (row: InvoiceDocument | Expense, source: PcnWarning["source"]) => {
    const isDoc = source === "document";
    const d = row as InvoiceDocument;
    const e = row as Expense;
    const add = (message: string, level: PcnWarningLevel = "error") => warnings.push({ level, message, source, sourceId: row.id, sourceLabel: isDoc ? docLabel(d) : expenseLabel(e) });
    if (!validPcnDate(row.date)) {
      add("התאריך חסר או אינו תקין. פתח את הרשומה ותקן את התאריך כדי שנוכל לשייך אותה לתקופת הדיווח.");
      return;
    }
    if (row.date < range.start || row.date > range.end) return;
    const net = isDoc ? (d.subtotalIls ?? d.subtotal) : e.amount - (e.vatAmount ?? 0);
    const vat = isDoc ? (d.vatIls ?? d.vat) : (e.vatAmount ?? 0);
    if (!withinField(net, 10) || !withinField(vat, 9) || !Number.isFinite(isDoc ? d.total : e.amount))
      add("סכום חסר, לא מספרי או גדול מדי לשדות קובץ הדיווח. בדוק את הסכום לפני מע״מ ואת המע״מ ברשומה.");
    if (!isDoc && (e.amount < 0 || vat < 0 || vat > e.amount))
      add("סכום ההוצאה או המע״מ אינו תקין: המע״מ חייב להיות בין אפס לסכום ההוצאה. זיכוי ספק דורש טיפול נפרד לפני הייצוא.");
    if (isDoc && ((net < 0 && vat > 0) || (net > 0 && vat < 0) || (net === 0 && vat !== 0)))
      add("סימני הסכום והמע״מ אינם תואמים. בדוק את נתוני החשבונית או הזיכוי.");
    if (isDoc && ((d.type === "credit_note" && (net > 0 || vat > 0)) || (d.type !== "credit_note" && (net < 0 || vat < 0))))
      add("סימן הסכום אינו תואם את סוג המסמך. זיכוי חייב לכלול סכומים שליליים וחשבונית רגילה סכומים חיוביים.");
    if (isDoc && d.zeroRated && vat !== 0) add("המסמך סומן בשיעור אפס אך כולל מע״מ. בדוק את הסיווג והסכומים לפני הייצוא.");
    if (isDoc && d.currency && d.currency !== "ILS" && (!Number.isFinite(d.subtotalIls) || !Number.isFinite(d.vatIls)))
      add("במסמך במטבע חוץ חסרים סכומי שקל שמורים. השלם את ההמרה לשקלים לפני הדיווח.");
    if (!isDoc && vat === 0) return;
    const id = String((isDoc ? d.clientTaxId : e.supplierTaxId) ?? "").trim();
    if (id && !validPcnVatId(id)) add("מספר העוסק כולל תווים שגויים, אינו בן 9 ספרות או שספרת הביקורת שגויה. בדוק מול החשבונית ותקן את המספר.");
    const reference = isDoc ? String(d.number) : referenceDigits(e.reference);
    if ((isDoc || e.reference) && (!/^\d{1,9}$/.test(reference) || Number(reference) === 0))
      add("מספר החשבונית חייב להיות מספר חיובי של עד 9 ספרות בשדה הדיווח. בדוק את האסמכתא; לא ניתן לקצר אותה אוטומטית.");
    if (!isDoc && (String(e.reference ?? "").match(/\d+/g)?.length ?? 0) > 1)
      add("האסמכתא כוללת כמה קבוצות ספרות. ודא שמספר החשבונית לדיווח הוא קבוצת הספרות האחרונה, או תקן את האסמכתא.", "warning");
    const allocation = String(row.allocationNumber ?? "").trim();
    if (allocation && (!/^\d{9}$/.test(allocation) || /^0+$/.test(allocation)))
      add("מספר ההקצאה חייב להיות 9 ספרות ואינו יכול להיות אפסים בלבד. העתק את המספר המקורי ללא קיצור.");
    // Distinct invoice series/types and suppliers may legitimately reuse numbers.
    const key = isDoc ? `document:${d.type}:${d.number}:${d.date.slice(0, 4)}` : `expense:${id}:${String(e.reference)}:${e.date}:${e.amount}:${vat}`;
    if ((isDoc || (id && reference)) && seen.has(key)) add("נמצאה רשומה נוספת עם אותם פרטי חשבונית. בדוק שלא נכלל כאן דיווח כפול.", "warning");
    seen.add(key);
  };
  documents.filter(d => SALES_TYPES.has(d.type) && d.status !== "draft" && d.status !== "cancelled").forEach(d => check(d, "document"));
  expenses.forEach(e => check(e, "expense"));
  return warnings;
}

// ── record builders ─────────────────────────────────────────────────

export function headerLine(h: PcnHeader): string {
  return [
    "O",
    fixedDigits(h.dealerVatId, 9),
    fixedDigits(h.reportMonth, 6),
    "1",
    fixedDigits(h.generationDate, 8),
    signedDigits(h.taxableSalesAmount, 11),
    signedDigits(h.taxableSalesVat, 9),
    signedDigits(0, 11), // sales at a different VAT rate
    signedDigits(0, 9), // their VAT
    fixedDigits(h.salesRecordCount, 9),
    signedDigits(h.zeroOrExemptSales, 11),
    signedDigits(h.otherInputsVat, 9),
    signedDigits(h.equipmentInputsVat, 9),
    fixedDigits(h.inputsCount, 9),
    signedDigits(h.totalVat, 11),
  ].join("");
}

export function transactionLine(t: PcnTransaction): string {
  return [
    t.entryType,
    fixedDigits(t.vatId, 9),
    fixedDigits(t.invoiceDate, 8),
    fixedDigits(t.refGroup, 4),
    fixedDigits(t.refNumber, 9),
    fixedDigits(Math.abs(t.totalVat), 9),
    signedDigits(t.invoiceSum, 10),
    fixedDigits(t.allocationNumber, 9),
  ].join("");
}

export function footerLine(dealerVatId: string): string {
  return `X${fixedDigits(dealerVatId, 9)}`;
}

export function pcn874Filename(dealerVatId: string, reportMonth: string): string {
  return `PCN874_${fixedDigits(dealerVatId, 9)}_${fixedDigits(reportMonth, 6)}.txt`;
}

// ── classification ──────────────────────────────────────────────────

const SALES_TYPES = new Set<InvoiceDocument["type"]>(["tax_invoice", "tax_invoice_receipt", "credit_note"]);
const SALES_LETTERS = new Set<PcnEntryType>(["S", "L", "M", "Y", "I"]);

function docLabel(d: InvoiceDocument): string {
  const kind = d.type === "credit_note" ? "חשבונית זיכוי" : d.type === "tax_invoice_receipt" ? "חשבונית מס/קבלה" : "חשבונית מס";
  return `${kind} ${d.number} · ${d.clientName || "ללא שם"}`;
}

function expenseLabel(e: Expense): string {
  // Israeli order (31.08.2026), never the raw ISO the store keeps.
  return `${e.supplier || "ספק לא ידוע"} · ${formatDate(e.date)}`;
}

/** Sort key the ITA simulator is indifferent to, but a stable file diff is nicer. */
const ENTRY_ORDER: PcnEntryType[] = ["S", "L", "M", "Y", "I", "T", "K", "R", "P", "H", "C"];

function sortTransactions(list: PcnTransaction[]): PcnTransaction[] {
  return [...list].sort((a, b) => {
    const t = ENTRY_ORDER.indexOf(a.entryType) - ENTRY_ORDER.indexOf(b.entryType);
    if (t !== 0) return t;
    if (a.invoiceDate !== b.invoiceDate) return a.invoiceDate < b.invoiceDate ? -1 : 1;
    return a.refNumber < b.refNumber ? -1 : a.refNumber > b.refNumber ? 1 : 0;
  });
}

interface InputsPass {
  transactions: PcnTransaction[];
  warnings: PcnWarning[];
  otherInputsVat: number;
  equipmentInputsVat: number;
}

/**
 * Classify the period's VAT-bearing expenses. `allowPetty` folds small
 * inputs without supplier details into one K record; a refund period runs
 * this again with it off, so every input is itemised.
 */
function classifyInputs(
  inputs: Expense[],
  periodEnd: string,
  allowPetty: boolean,
): InputsPass {
  const transactions: PcnTransaction[] = [];
  const warnings: PcnWarning[] = [];
  let otherInputsVat = 0;
  let equipmentInputsVat = 0;
  const petty = { sum: 0, vat: 0, ids: [] as string[] };

  for (const e of inputs) {
    const vat = roundShekel(e.vatAmount ?? 0);
    const net = roundShekel(Math.max(0, e.amount - (e.vatAmount ?? 0)));
    if (vat === 0) continue;

    if (e.isEquipment) equipmentInputsVat += vat;
    else otherInputsVat += vat;

    const supplierVat = normalizeCustomerVatNumber(e.supplierTaxId);
    const reference = referenceDigits(e.reference);
    const allocation = digitsOnly(e.allocationNumber);

    if (!supplierVat || !reference) {
      if (allowPetty && vat < PETTY_CASH_VAT_THRESHOLD) {
        petty.sum += net;
        petty.vat += vat;
        petty.ids.push(e.id);
        continue;
      }
      warnings.push({
        level: "error",
        message: allowPetty
          ? `הוצאה עם מע״מ של ${vat.toLocaleString("he-IL")} ₪ (מעל 300 ₪) חייבת מספר עוסק ומספר חשבונית של הספק. פתח את ההוצאה והשלם את הפרטים.`
          : "בדוח להחזר כל תשומה מדווחת בנפרד, ולכן גם הוצאה קטנה חייבת מספר עוסק ומספר חשבונית של הספק.",
        source: "expense",
        sourceId: e.id,
        sourceLabel: expenseLabel(e),
      });
    }

    if (
      supplierVat &&
      !allocation &&
      allocationApplies(e.date, e.amount - (e.vatAmount ?? 0))
    ) {
      warnings.push({
        level: "error",
        message: "חשבונית ספק מעל סף חשבונית ישראל בלי מספר הקצאה. בלי המספר מע״מ לא יכיר בתשומה.",
        source: "expense",
        sourceId: e.id,
        sourceLabel: expenseLabel(e),
      });
    }

    transactions.push({
      entryType: "T",
      vatId: supplierVat || "000000000",
      invoiceDate: isoToYyyymmdd(e.date),
      refGroup: "0000",
      refNumber: reference ? fixedDigits(reference, 9) : "000000000",
      totalVat: vat,
      invoiceSum: net,
      allocationNumber: allocation ? fixedDigits(allocation, 9) : "000000000",
      sourceIds: [e.id],
    });
  }

  if (petty.ids.length > 0) {
    transactions.push({
      entryType: "K",
      vatId: "000000000",
      invoiceDate: periodEnd,
      refGroup: "0000",
      refNumber: fixedDigits(petty.ids.length, 9),
      totalVat: petty.vat,
      invoiceSum: petty.sum,
      allocationNumber: "000000000",
      sourceIds: petty.ids,
    });
  }

  return { transactions, warnings, otherInputsVat, equipmentInputsVat };
}

export function buildPcn874(args: BuildPcn874Args): Pcn874Result {
  const { business, documents, expenses, range } = args;
  const generatedOn = args.generatedOn ?? new Date();
  const dealerDigits = digitsOnly(business.taxId);
  const dealerVatId = fixedDigits(dealerDigits, 9);
  const reportMonth = range.end.slice(0, 7).replace("-", "");
  const periodEnd = isoToYyyymmdd(range.end);

  // ── whole-file blockers ──
  const blockers: string[] = [];
  if (!validPcnVatId(String(business.taxId).trim())) {
    blockers.push("מספר העוסק של העסק בהגדרות חייב להיות 9 ספרות עם ספרת ביקורת תקינה. תקן אותו לפני הדיווח.");
  }
  if (!validPcnDate(range.start) || !validPcnDate(range.end) || range.start > range.end) {
    blockers.push("תקופת הדיווח אינה תקינה. בחר תאריכי התחלה וסיום תקינים לפי הסדר.");
  } else {
    const next = new Date(range.end + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    if (!range.start.endsWith("-01") || next.getUTCDate() !== 1)
      blockers.push("בחר חודשים מלאים: מהיום הראשון בחודש ועד היום האחרון בחודש הסיום.");
  }
  if (!Number.isFinite(generatedOn.getTime())) blockers.push("תאריך הפקת הקובץ אינו תקין.");
  if (business.businessType === "exempt") blockers.push("עוסק פטור אינו מגיש דוח מע״מ מפורט. בדוק את סוג העסק בהגדרות.");
  const months = monthsInRange(range);
  if (months !== 1 && months !== 2) {
    blockers.push("קובץ PCN874 מוגש לחודש אחד או לחודשיים. בחר תקופת דיווח חודשית או דו-חודשית.");
  }
  if (range.end >= isoDateInIsrael(generatedOn)) {
    blockers.push("תקופת הדיווח עוד לא הסתיימה. הקובץ מופק אחרי סוף התקופה, כשכל המסמכים בפנים.");
  }

  const transactions: PcnTransaction[] = [];
  const warnings: PcnWarning[] = validateSources(documents, expenses, range);

  // ── sales ──
  const sales = documents.filter(
    (d) =>
      SALES_TYPES.has(d.type) &&
      d.status !== "draft" &&
      d.status !== "cancelled" &&
      d.date >= range.start &&
      d.date <= range.end,
  );

  let taxableSalesAmount = 0;
  let taxableSalesVat = 0;
  let zeroOrExemptSales = 0;

  // Unidentified small sales are summed into one L record.
  const unidentified = { sum: 0, vat: 0, ids: [] as string[] };

  for (const d of sales) {
    // Shekel figures: foreign-currency documents snapshot ILS equivalents at
    // issue; the plain fields ARE shekels for ILS documents. Credit notes are
    // stored negative already, so the sign carries through.
    const sum = roundShekel(d.subtotalIls ?? d.subtotal);
    const vat = roundShekel(d.vatIls ?? d.vat);
    const customerVat = normalizeCustomerVatNumber(d.clientTaxId);
    const allocation = digitsOnly(d.allocationNumber);
    const allocationField = allocation ? fixedDigits(allocation, 9) : "000000000";

    if (d.zeroRated) {
      // Explicitly marked zero-rate / export. With an Israeli VAT number it is
      // a domestic zero-rated sale (S with VAT 0); without one it is an export
      // (Y, counterparty 999999999). Both land in the exempt box.
      zeroOrExemptSales += sum;
      transactions.push({
        entryType: customerVat ? "S" : "Y",
        vatId: customerVat || "999999999",
        invoiceDate: isoToYyyymmdd(d.date),
        refGroup: "0000",
        refNumber: fixedDigits(d.number, 9),
        totalVat: 0,
        invoiceSum: sum,
        allocationNumber: customerVat ? allocationField : "000000000",
        sourceIds: [d.id],
      });
      continue;
    }

    taxableSalesAmount += sum;
    taxableSalesVat += vat;

    if (vat === 0 && sum !== 0) {
      warnings.push({
        level: "warning",
        message: "מסמך מס בלי מע״מ שלא סומן כעסקה בשיעור אפס. הוא מדווח כעסקה חייבת; אם זו עסקה פטורה או ייצוא, סמן זאת במסמך.",
        source: "document",
        sourceId: d.id,
        sourceLabel: docLabel(d),
      });
    }

    if (!customerVat && Math.abs(sum) < IDENTIFIED_SALE_THRESHOLD) {
      unidentified.sum += sum;
      unidentified.vat += vat;
      unidentified.ids.push(d.id);
      continue;
    }

    if (!customerVat) {
      warnings.push({
        level: "error",
        message: `עסקה של ${Math.abs(sum).toLocaleString("he-IL")} ₪ לפני מע״מ חייבת מספר עוסק של הלקוח. הוסף את המספר ללקוח ולמסמך, אחרת מע״מ ידחה את הרשומה.`,
        source: "document",
        sourceId: d.id,
        sourceLabel: docLabel(d),
      });
    }

    // Same gate the editor enforces (חשבונית ישראל): tax documents to a
    // business customer at or above the year's threshold.
    if (!allocation && customerVat && vat > 0 && allocationApplies(d.date, d.subtotalIls ?? d.subtotal)) {
      warnings.push({
        level: "warning",
        message: "מסמך מס מעל סף חשבונית ישראל בלי מספר הקצאה. קבל מספר הקצאה מעמוד המסמך לפני הדיווח.",
        source: "document",
        sourceId: d.id,
        sourceLabel: docLabel(d),
      });
    }

    transactions.push({
      entryType: "S",
      vatId: customerVat || "000000000",
      invoiceDate: isoToYyyymmdd(d.date),
      refGroup: "0000",
      refNumber: fixedDigits(d.number, 9),
      totalVat: Math.abs(vat),
      invoiceSum: sum,
      allocationNumber: allocationField,
      sourceIds: [d.id],
    });
  }

  if (unidentified.ids.length > 0) {
    transactions.push({
      entryType: "L",
      vatId: "000000000",
      invoiceDate: periodEnd,
      refGroup: "0000",
      refNumber: fixedDigits(unidentified.ids.length, 9),
      totalVat: Math.abs(unidentified.vat),
      invoiceSum: unidentified.sum,
      allocationNumber: "000000000",
      sourceIds: unidentified.ids,
    });
  }

  // ── inputs ──
  const inputs = expenses.filter(
    (e) => e.date >= range.start && e.date <= range.end && (e.vatAmount ?? 0) > 0,
  );

  let pass = classifyInputs(inputs, periodEnd, true);
  const refundPeriod = taxableSalesVat - pass.otherInputsVat - pass.equipmentInputsVat < 0;
  if (refundPeriod && pass.transactions.some((t) => t.entryType === "K")) {
    pass = classifyInputs(inputs, periodEnd, false);
  }
  transactions.push(...pass.transactions);
  warnings.push(...pass.warnings);
  const { otherInputsVat, equipmentInputsVat } = pass;

  const sorted = sortTransactions(transactions);
  const salesRecordCount = sorted.filter((t) => SALES_LETTERS.has(t.entryType)).length;
  const inputsCount = sorted.length - salesRecordCount;
  const totalVat = taxableSalesVat - otherInputsVat - equipmentInputsVat;

  const header: PcnHeader = {
    dealerVatId,
    reportMonth,
    generationDate: yyyymmddToday(generatedOn),
    taxableSalesAmount,
    taxableSalesVat,
    salesRecordCount,
    zeroOrExemptSales,
    otherInputsVat,
    equipmentInputsVat,
    inputsCount,
    totalVat,
  };

  for (const [field, value] of Object.entries(header)) {
    if (typeof value === "number" && !withinField(value, ["taxableSalesAmount", "zeroOrExemptSales", "totalVat"].includes(field) ? 11 : 9))
      blockers.push("סכום או מונה חורג מגודל השדה בקובץ: " + field + ". יש לבדוק את נתוני הדוח.");
  }
  for (const t of sorted) {
    if (!withinField(t.invoiceSum, 10) || !withinField(t.totalVat, 9))
      blockers.push("סכום רשומה חורג מגודל השדה בקובץ. בדוק את הרשומות המרוכזות: " + t.entryType + " " + t.refNumber);
  }
  const lines = [headerLine(header), ...sorted.map(transactionLine), footerLine(dealerVatId)];

  blockers.push(...validatePcn874Content(lines.join("\r\n") + "\r\n"));

  return {
    filename: pcn874Filename(dealerVatId, reportMonth),
    content: lines.join("\r\n") + "\r\n",
    header,
    transactions: sorted,
    warnings,
    blockers,
    refundPeriod,
    figures: {
      taxableSales: taxableSalesAmount,
      outputVat: taxableSalesVat,
      zeroOrExemptSales,
      equipmentInputVat: equipmentInputsVat,
      otherInputVat: otherInputsVat,
      netDue: totalVat,
    },
  };
}

/**
 * Structural self-check of a generated file: record lengths, letters, that
 * the header's counts match the body, and that the header's VAT totals equal
 * the sum of the body's VAT fields (signed by each record's sum). Mirrors
 * what the ITA simulator rejects on first sight, so the UI can refuse to
 * hand over a broken file.
 */
export function validatePcn874Content(content: string): string[] {
  const problems: string[] = [];
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return ["הקובץ ריק"];
  const [header, ...rest] = lines;
  const footer = rest.pop() ?? "";
  if (!/^O\d{15}1\d{8}[+-]\d{11}[+-]\d{9}[+-]\d{11}[+-]\d{9}\d{9}[+-]\d{11}[+-]\d{9}[+-]\d{9}\d{9}[+-]\d{11}$/.test(header))
    problems.push("רשומת הפתיחה כוללת שדה מספרי, סימן או סוג דיווח לא תקין");
  if (!/^X\d{9}$/.test(footer)) problems.push("רשומת הסיום כוללת תווים לא תקינים");
  if (!validPcnVatId(header.slice(1, 10))) problems.push("מספר העוסק בפתיחה אינו תקין");
  if (!validPcnDate(`${header.slice(10, 14)}-${header.slice(14, 16)}-01`) || !validCompactDate(header.slice(17, 25)))
    problems.push("תקופת הדיווח או תאריך ההפקה בפתיחה אינם תקינים");
  if (header.length !== 131 || header[0] !== "O") problems.push("רשומת הפתיחה אינה באורך 131 תווים");
  if (footer.length !== 10 || footer[0] !== "X") problems.push("רשומת הסיום אינה באורך 10 תווים");
  if (header.slice(1, 10) !== footer.slice(1, 10)) problems.push("מספר העוסק ברשומת הסיום שונה מזה שבפתיחה");

  const signed = (s: string) => (s[0] === "-" ? -1 : 1) * parseInt(s.slice(1), 10);
  const headerSalesVat = signed(header.slice(37, 47));
  const headerInputsVat = signed(header.slice(90, 100)) + signed(header.slice(100, 110));
  const salesCount = parseInt(header.slice(69, 78), 10);
  const inputsCount = parseInt(header.slice(110, 119), 10);

  let sales = 0;
  let inputs = 0;
  let bodySalesVat = 0;
  let bodyInputsVat = 0;
  let bodySalesAmount = 0;
  rest.forEach((l, i) => {
    if (l.length !== 60) problems.push(`רשומה ${i + 1} אינה באורך 60 תווים`);
    if (!/^[SLMYITKRPHC]\d{39}[+-]\d{19}$/.test(l)) problems.push(`רשומה ${i + 1} כוללת שדה מספרי או סימן לא תקין`);
    if (!validCompactDate(l.slice(10, 18))) problems.push(`התאריך ברשומה ${i + 1} אינו תקין`);
    if ("ST".includes(l[0]) && !validPcnVatId(l.slice(1, 10))) problems.push(`מספר העוסק ברשומה ${i + 1} אינו תקין`);
    if (Number(l.slice(22, 31)) === 0) problems.push(`מספר החשבונית או מונה החשבוניות ברשומה ${i + 1} הוא אפס`);
    const vat = parseInt(l.slice(31, 40), 10) || 0;
    const sign = l[40] === "-" ? -1 : 1;
    if ("SLMYI".includes(l[0])) {
      sales += 1;
      bodySalesVat += sign * vat;
      bodySalesAmount += signed(l.slice(40, 51));
    } else if ("TKRPHC".includes(l[0])) {
      inputs += 1;
      bodyInputsVat += sign * vat;
    } else problems.push(`רשומה ${i + 1} מתחילה בסוג לא מוכר "${l[0]}"`);
  });
  if (sales !== salesCount) problems.push(`מספר רשומות העסקאות (${sales}) שונה ממה שרשום בפתיחה (${salesCount})`);
  if (inputs !== inputsCount) problems.push(`מספר רשומות התשומות (${inputs}) שונה ממה שרשום בפתיחה (${inputsCount})`);
  if (bodySalesVat !== headerSalesVat) problems.push(`מס העסקאות בפתיחה (${headerSalesVat}) שונה מסכום הרשומות (${bodySalesVat})`);
  if (bodyInputsVat !== headerInputsVat) problems.push(`מס התשומות בפתיחה (${headerInputsVat}) שונה מסכום הרשומות (${bodyInputsVat})`);
  if (bodySalesAmount !== signed(header.slice(25, 37)) + signed(header.slice(47, 59)) + signed(header.slice(78, 90)))
    problems.push("סכום העסקאות בפתיחה שונה מסכום רשומות העסקאות");
  if (signed(header.slice(119, 131)) !== headerSalesVat + signed(header.slice(59, 69)) - headerInputsVat)
    problems.push("הסכום לתשלום או להחזר אינו תואם את ההפרש בין מס העסקאות למס התשומות");
  return problems;
}

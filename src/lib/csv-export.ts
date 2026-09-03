/**
 * The app's "ייצוא ל-Excel" exports. Despite the file name (kept so the
 * callers did not have to move) these produce styled .xlsx workbooks since
 * 2026-09-03, not CSV: a title block, a peach header row, real dates and
 * ₪-formatted numbers, and a bold total row - the same anatomy as the
 * printed sheet (print-sheet.tsx). See xlsx-export.ts for the rendering.
 */
import type { InvoiceDocument, Expense, Client, DocumentType } from "./types";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "./types";
import { formatDate } from "./format";
import type { OpenReceivablesResult } from "./capital-declaration";
import { downloadXlsx, sheet } from "./xlsx-export";

/** Header-block context every export can carry. */
export interface ExportMeta {
  businessName?: string;
  /** One line describing the slice: period, filters, client. */
  subtitle?: string;
}

/** Local-time YYYY-MM-DD for file names. */
function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function fileName(base: string, suffix?: string): string {
  const tag = suffix ? `-${suffix}` : "";
  return `${base}${tag}-${todayIso()}.xlsx`;
}

/** Whole shekels for a document, foreign currency normalized. */
const docTotal = (d: InvoiceDocument) => d.totalIls ?? d.total;
const docSubtotal = (d: InvoiceDocument) => d.subtotalIls ?? d.subtotal;
const docVat = (d: InvoiceDocument) => d.vatIls ?? d.vat;

/** Drafts and cancelled documents are money never billed: out of the total. */
const isBilled = (d: InvoiceDocument) => d.status !== "draft" && d.status !== "cancelled";

function billedSum(docs: InvoiceDocument[], pick: (d: InvoiceDocument) => number): number {
  return docs.reduce((sum, d) => (isBilled(d) ? sum + pick(d) : sum), 0);
}

export function exportDocuments(documents: InvoiceDocument[], suffix?: string, meta: ExportMeta = {}) {
  const hasUnbilled = documents.some((d) => !isBilled(d));
  return downloadXlsx(
    fileName("documents", suffix),
    [
      sheet<InvoiceDocument>({
        name: "מסמכים",
        title: "רשימת מסמכים",
        subtitle: meta.subtitle,
        businessName: meta.businessName,
        countLabel: `${documents.length} מסמכים`,
        rows: documents,
        // Same rule as the printed list: drafts and cancelled documents sit
        // in the rows but not in the total, and the label says so.
        totalLabel: hasUnbilled ? "סה״כ (ללא טיוטות ומבוטלים)" : "סה״כ",
        columns: [
          { header: "מספר", value: (d) => d.number, kind: "int", width: 9 },
          { header: "סוג", value: (d) => DOCUMENT_TYPE_LABELS[d.type] },
          { header: "תאריך", value: (d) => d.date, kind: "date" },
          { header: "לקוח", value: (d) => d.clientName },
          { header: "נושא", value: (d) => d.subject || "" },
          { header: "סטטוס", value: (d) => DOCUMENT_STATUS_LABELS[d.status] },
          { header: "סכום ביניים", value: docSubtotal, kind: "money", total: (rows) => billedSum(rows, docSubtotal) },
          { header: "מע״מ", value: docVat, kind: "money", total: (rows) => billedSum(rows, docVat) },
          { header: "סה״כ", value: docTotal, kind: "money", total: (rows) => billedSum(rows, docTotal) },
          { header: "אמצעי תשלום", value: (d) => (d.paymentMethod ? PAYMENT_METHOD_LABELS[d.paymentMethod] : "") },
          { header: "הערות", value: (d) => d.notes || "", width: 30 },
        ],
      }),
    ],
  );
}

export function exportExpenses(
  expenses: Expense[],
  suffix?: string,
  meta: ExportMeta & { showVat?: boolean } = {},
) {
  // עוסק פטור never records VAT on expenses, so the two VAT columns would be
  // all zeros; show them only when the business (or the data) has VAT.
  const showVat = meta.showVat ?? expenses.some((e) => (e.vatAmount ?? 0) > 0);
  return downloadXlsx(
    fileName("expenses", suffix),
    [
      sheet<Expense>({
        name: "הוצאות",
        title: "רשימת הוצאות",
        subtitle: meta.subtitle,
        businessName: meta.businessName,
        countLabel: `${expenses.length} הוצאות`,
        rows: expenses,
        columns: [
          { header: "תאריך", value: (e) => e.date, kind: "date" },
          { header: "קטגוריה", value: (e) => e.category },
          { header: "ספק", value: (e) => e.supplier },
          { header: "תיאור", value: (e) => e.description || "", width: 34 },
          ...(showVat
            ? [
                { header: "סכום ללא מע״מ", value: (e: Expense) => e.amount - (e.vatAmount ?? 0), kind: "money" as const, total: "sum" as const },
                { header: "מע״מ", value: (e: Expense) => e.vatAmount ?? 0, kind: "money" as const, total: "sum" as const },
              ]
            : []),
          { header: showVat ? "סכום כולל מע״מ" : "סכום", value: (e) => e.amount, kind: "money", total: "sum" },
        ],
      }),
    ],
  );
}

/** The reports page's month-by-month table (income / expenses / profit). */
export function exportMonthlySummary(
  rows: {
    month: string;
    label: string;
    income: number;
    expenses: number;
    docs?: number;
    margin?: number | null;
    cumulative?: number;
  }[],
  suffix?: string,
  meta: ExportMeta = {},
) {
  type Row = (typeof rows)[number];
  const income = rows.reduce((s, r) => s + r.income, 0);
  const expenses = rows.reduce((s, r) => s + r.expenses, 0);
  const profit = income - expenses;
  const hasDocs = rows.some((r) => r.docs !== undefined);
  const hasCumulative = rows.some((r) => r.cumulative !== undefined);
  return downloadXlsx(
    fileName("monthly-summary", suffix),
    [
      sheet<Row>({
        name: "פירוט חודשי",
        title: "פירוט חודשי",
        subtitle: meta.subtitle,
        businessName: meta.businessName,
        countLabel: `${rows.length} חודשים`,
        rows,
        columns: [
          { header: "חודש", value: (r) => r.label, width: 16 },
          ...(hasDocs ? [{ header: "מסמכים", value: (r: Row) => r.docs ?? 0, kind: "int" as const, total: "sum" as const }] : []),
          { header: "הכנסות", value: (r) => r.income, kind: "money", total: "sum" },
          { header: "הוצאות", value: (r) => r.expenses, kind: "money", total: "sum" },
          { header: "רווח", value: (r) => r.income - r.expenses, kind: "money", total: "sum" },
          {
            header: "שולי רווח",
            value: (r) => r.margin ?? null,
            kind: "percent",
            total: () => (income > 0 ? Math.round((profit / income) * 100) : null),
          },
          ...(hasCumulative
            ? [{ header: "רווח מצטבר", value: (r: Row) => r.cumulative ?? null, kind: "money" as const, total: () => profit }]
            : []),
        ],
      }),
    ],
  );
}

/**
 * Draft export for the הצהרת הון (capital declaration) helper: the business
 * slice ONLY (declared income per year + open receivables), plus an explicit
 * checklist of everything the app does not know.
 *
 * This is a DRAFT for an accountant, not a filled form - the title and the
 * notes say so in plain text, because a spreadsheet loses whatever
 * on-screen disclaimer surrounded it.
 */
export function exportCapitalDeclarationDraft(params: {
  asOfDate: string;
  yearRows: { year: number; income: number; expenses: number; profit: number }[];
  receivables: OpenReceivablesResult;
  notCoveredCategories: string[];
  businessName?: string;
}) {
  const { asOfDate, yearRows, receivables, notCoveredCategories, businessName } = params;
  type YearRow = (typeof yearRows)[number];
  type Receivable = OpenReceivablesResult["docs"][number];
  const subtitle = `טיוטת הכנה להצהרת הון (טופס 1219) - חלק עסקי בלבד · נכון ל-${formatDate(asOfDate)}`;
  const disclaimer = [
    "זו טיוטה לרואה החשבון, לא הצהרה מלאה. המערכת מכירה רק את הצד העסקי: הכנסות והוצאות שנרשמו בה וחייבים פתוחים.",
    "המערכת אינה מכירה נכסים אישיים (בנק, נדל״ן, ניירות ערך, רכבים, הלוואות). יש להשלים בנפרד ולאמת מול רואה חשבון.",
  ];

  return downloadXlsx(`הצהרת-הון-טיוטה-עסקית-${todayIso()}.xlsx`, [
    sheet<YearRow>({
      name: "הכנסות לפי שנה",
      title: "הכנסות עסקיות מוצהרות",
      subtitle,
      businessName,
      countLabel: `${yearRows.length} שנים`,
      rows: yearRows,
      notes: disclaimer,
      columns: [
        { header: "שנה", value: (r) => String(r.year), width: 10 },
        { header: "הכנסות", value: (r) => r.income, kind: "money", total: "sum" },
        { header: "הוצאות", value: (r) => r.expenses, kind: "money", total: "sum" },
        { header: "רווח נקי", value: (r) => r.profit, kind: "money", total: "sum" },
      ],
    }),
    sheet<Receivable>({
      name: "חייבים פתוחים",
      title: "חייבים פתוחים (נכס בהצהרת הון)",
      subtitle: `מסמכים שהופקו ולא שולמו נכון ל-${formatDate(asOfDate)}`,
      businessName,
      countLabel: `${receivables.count} מסמכים`,
      rows: receivables.docs,
      columns: [
        { header: "סוג", value: (d) => DOCUMENT_TYPE_LABELS[d.type as DocumentType] },
        { header: "מספר", value: (d) => d.number, kind: "int", width: 9 },
        { header: "לקוח", value: (d) => d.clientName },
        { header: "תאריך", value: (d) => d.date, kind: "date" },
        { header: "סכום", value: (d) => d.totalIls ?? d.total, kind: "money", total: "sum" },
      ],
    }),
    sheet<string>({
      name: "להשלמה בנפרד",
      title: "עדיין לא מכוסה - למלא בנפרד",
      subtitle: "סעיפים בטופס 1219 שהמערכת לא מכירה",
      businessName,
      countLabel: `${notCoveredCategories.length} סעיפים`,
      rows: notCoveredCategories,
      columns: [
        { header: "סעיף", value: (c) => c, width: 60 },
        { header: "ערך", value: () => "לא ידוע למערכת", width: 18 },
      ],
    }),
  ]);
}

export function exportClients(clients: Client[], meta: ExportMeta = {}) {
  return downloadXlsx(
    fileName("clients"),
    [
      sheet<Client>({
        name: "לקוחות",
        title: "רשימת לקוחות",
        subtitle: meta.subtitle,
        businessName: meta.businessName,
        countLabel: `${clients.length} לקוחות`,
        rows: clients,
        columns: [
          { header: "שם", value: (c) => c.name },
          { header: "ח.פ / ת.ז", value: (c) => c.taxId || "" },
          { header: "כתובת", value: (c) => c.address || "", width: 28 },
          { header: "טלפון", value: (c) => c.phone || "" },
          { header: "אימייל", value: (c) => c.email || "" },
          { header: "הערות", value: (c) => c.notes || "", width: 30 },
          { header: "נוסף בתאריך", value: (c) => c.createdAt.slice(0, 10), kind: "date" },
        ],
      }),
    ],
  );
}

/* ---------- the report pages' own exports (used to be inline CSV writers) ---------- */

/** /reports/custom: the filtered document list with VAT breakdown and allocation numbers. */
export function exportCustomReport(params: {
  rows: InvoiceDocument[];
  taxIdFor: (d: InvoiceDocument) => string;
  subtitle: string;
  businessName?: string;
}) {
  const { rows, taxIdFor, subtitle, businessName } = params;
  return downloadXlsx(`דוח-מותאם-${todayIso()}.xlsx`, [
    sheet<InvoiceDocument>({
      name: "דוח מותאם",
      title: "דוח מותאם",
      subtitle,
      businessName,
      countLabel: `${rows.length} מסמכים`,
      rows,
      columns: [
        { header: "תאריך", value: (d) => d.date, kind: "date" },
        { header: "מספר", value: (d) => d.number, kind: "int", width: 9 },
        { header: "סוג מסמך", value: (d) => DOCUMENT_TYPE_LABELS[d.type] },
        { header: "לקוח", value: (d) => d.clientName },
        { header: "ת.ז / ח.פ", value: taxIdFor },
        { header: "סכום לא כולל מע״מ", value: docSubtotal, kind: "money", total: "sum" },
        { header: "מע״מ", value: docVat, kind: "money", total: "sum" },
        { header: "סכום כולל מע״מ", value: docTotal, kind: "money", total: "sum" },
        { header: "מספר הקצאה", value: (d) => d.allocationNumber || "" },
        { header: "סטטוס", value: (d) => DOCUMENT_STATUS_LABELS[d.status] },
      ],
    }),
  ]);
}

/** /reports/invoices-period: the accountant's VAT-document listing for a period. */
export function exportInvoicesPeriod(params: {
  rows: {
    type: DocumentType;
    number: number;
    date: string;
    customerTaxId: string;
    clientName: string;
    net: number;
    vat: number;
    total: number;
    allocation: string;
  }[];
  periodLabel: string;
  fileTag: string;
  businessName?: string;
}) {
  const { rows, periodLabel, fileTag, businessName } = params;
  type Row = (typeof rows)[number];
  return downloadXlsx(`דוח-חשבוניות-${fileTag}.xlsx`, [
    sheet<Row>({
      name: "חשבוניות",
      title: "דוח חשבוניות לתקופה",
      subtitle: periodLabel,
      businessName,
      countLabel: `${rows.length} מסמכים`,
      rows,
      columns: [
        { header: "ת.ז / ח.פ", value: (r) => r.customerTaxId },
        { header: "מספר חשבונית", value: (r) => r.number, kind: "int", width: 13 },
        { header: "סוג", value: (r) => DOCUMENT_TYPE_LABELS[r.type] },
        { header: "לקוח", value: (r) => r.clientName },
        { header: "תאריך", value: (r) => r.date, kind: "date" },
        { header: "סכום ללא מע״מ", value: (r) => r.net, kind: "money", total: "sum" },
        { header: "מע״מ", value: (r) => r.vat, kind: "money", total: "sum" },
        { header: "סכום כולל מע״מ", value: (r) => r.total, kind: "money", total: "sum" },
        { header: "מספר הקצאה", value: (r) => r.allocation },
      ],
    }),
  ]);
}

/** VAT period report: the detailed expense (input VAT) listing. */
export function exportVatPeriodExpenses(params: {
  rows: { date: string; supplier: string; category: string; description?: string; net: number; vat: number; amount: number }[];
  range: { start: string; end: string; label?: string };
  businessName?: string;
}) {
  const { rows, range, businessName } = params;
  type Row = (typeof rows)[number];
  return downloadXlsx(`הוצאות-${range.start}_עד_${range.end}.xlsx`, [
    sheet<Row>({
      name: "הוצאות",
      title: "פירוט הוצאות לתקופת המע״מ",
      subtitle: range.label ?? `${formatDate(range.start)} עד ${formatDate(range.end)}`,
      businessName,
      countLabel: `${rows.length} הוצאות`,
      rows,
      columns: [
        { header: "תאריך", value: (r) => r.date, kind: "date" },
        { header: "ספק", value: (r) => r.supplier },
        { header: "קטגוריה", value: (r) => r.category },
        { header: "תיאור", value: (r) => r.description ?? "", width: 34 },
        { header: "סכום ללא מע״מ", value: (r) => r.net, kind: "money", total: "sum" },
        { header: "מע״מ", value: (r) => r.vat, kind: "money", total: "sum" },
        { header: "סכום כולל", value: (r) => r.amount, kind: "money", total: "sum" },
      ],
    }),
  ]);
}

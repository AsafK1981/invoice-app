// דוח תקופתי לרשות המסים - one report for the periodic filing.
//
// The Tax Authority's periodic filing ("דיווח ותשלום דוח תקופתי") is one
// submission per month or bi-month that carries both sides of the business:
// the VAT return (עסקאות = income, תשומות = expenses, six figures) and the
// income-tax advance (מקדמה: turnover × rate). The app already computes
// every one of those figures (src/lib/ita/pcn874.ts, income-tax-advances.ts,
// expense-report.ts); this module composes them for ONE period so the
// screen shows, in filing order, what to type and the income and expense
// rows the figures are made of. Nothing here recomputes tax logic: the six
// VAT figures are buildPcn874().figures, the advance is computeAdvance(),
// and the PCN874 result (blockers + warnings) rides along so the page shows
// the same data checks as /reports/vat instead of confident numbers built
// on broken rows.

import type { Business, Expense, InvoiceDocument } from "./types";
import { DOCUMENT_TYPE_LABELS } from "./types";
import { buildPcn874, type Pcn874Result, type VatReturnFigures } from "./ita/pcn874";
import { computeAdvance, countsForTurnover, type AdvanceComputation } from "./ita/income-tax-advances";
import { buildExpenseReport, type ExpenseReport } from "./expense-report";
import { periodLabel, type Period } from "./report-period";
import { toIsraelDate } from "./date";

export interface FilingRange {
  /** Inclusive ISO date. */
  start: string;
  /** Inclusive ISO date - the natural end of the period, never clipped to today. */
  end: string;
  /** "אוגוסט 2026" / "יול׳-אוג׳ 2026". */
  label: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// Strict on purpose: report-period's periodMode() treats any unknown string
// as a month, so "?period=abc" or "2026-13" must be refused here, not later.
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const BIMONTH_RE = /^(\d{4})-B([1-6])$/;

/** Only a real month ("2026-08") or bi-month ("2026-B4") can be filed. */
export function isFilingPeriod(p: string): boolean {
  return MONTH_RE.test(p) || BIMONTH_RE.test(p);
}

export function filingMode(p: Period): "month" | "bimonth" | null {
  return MONTH_RE.test(p) ? "month" : BIMONTH_RE.test(p) ? "bimonth" : null;
}

/** First and last calendar month (1-12) of a filing period. */
function monthSpan(p: Period): { year: number; from: number; to: number } | null {
  const b = BIMONTH_RE.exec(p);
  if (b) {
    const n = Number(b[2]);
    return { year: Number(b[1]), from: n * 2 - 1, to: n * 2 };
  }
  const m = MONTH_RE.exec(p);
  if (m) return { year: Number(m[1]), from: Number(m[2]), to: Number(m[2]) };
  return null;
}

/**
 * The calendar bounds of a filing period. Unlike report-period's
 * `periodRange`, the end is NOT clipped to today: the form is about the
 * whole period, and the "has it ended yet" question is asked separately.
 */
export function filingRange(p: Period): FilingRange | null {
  const span = monthSpan(p);
  if (!span) return null;
  const lastDay = new Date(span.year, span.to, 0).getDate();
  return {
    start: `${span.year}-${pad2(span.from)}-01`,
    end: `${span.year}-${pad2(span.to)}-${pad2(lastDay)}`,
    label: periodLabel(p),
  };
}

/** True once the period's last day is behind us - only then is there something to file. */
export function filingPeriodEnded(p: Period, today = new Date()): boolean {
  const range = filingRange(p);
  return !!range && range.end < toIsraelDate(today);
}

/**
 * Where the page opens: the last bi-month that has fully ended. Most
 * freelancers file bi-monthly, and a period still in progress would show a
 * form nobody can submit yet. A monthly filer switches once; the choice
 * then rides in the URL.
 */
export function defaultFilingPeriod(today = new Date()): Period {
  const iso = toIsraelDate(today);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const currentB = Math.ceil(month / 2);
  return currentB === 1 ? `${year - 1}-B6` : `${year}-B${currentB - 1}`;
}

/**
 * Switch between month and bi-month while staying on the period the user is
 * about to file. Bi-month to month lands on the LAST month of it that has
 * ended (Jul-Aug in September becomes August, the month a monthly filer
 * files now), or its first month when none has ended yet.
 */
export function switchFilingMode(p: Period, mode: "month" | "bimonth", today = new Date()): Period {
  const span = monthSpan(p);
  if (!span) return defaultFilingPeriod(today);
  if (mode === "bimonth") return `${span.year}-B${Math.ceil(span.from / 2)}`;
  if (filingMode(p) === "month") return p;
  const todayIso = toIsraelDate(today);
  for (let m = span.to; m >= span.from; m--) {
    const lastDay = new Date(span.year, m, 0).getDate();
    if (`${span.year}-${pad2(m)}-${pad2(lastDay)}` < todayIso) return `${span.year}-${pad2(m)}`;
  }
  return `${span.year}-${pad2(span.from)}`;
}

/** Step one filing period back or forward. */
export function shiftFilingPeriod(p: Period, delta: 1 | -1): Period {
  const span = monthSpan(p);
  if (!span) return p;
  if (filingMode(p) === "bimonth") {
    const n = Math.ceil(span.from / 2) + delta;
    if (n < 1) return `${span.year - 1}-B6`;
    if (n > 6) return `${span.year + 1}-B1`;
    return `${span.year}-B${n}`;
  }
  const m = span.from + delta;
  if (m < 1) return `${span.year - 1}-12`;
  if (m > 12) return `${span.year + 1}-01`;
  return `${span.year}-${pad2(m)}`;
}

/**
 * /reports/vat (the PCN874 file) only knows periods relative to today. This
 * maps a filing period onto one of them, or null when that report cannot show
 * this period, so the page never links to a different period's file.
 */
export function vatReportModeFor(p: Period, today = new Date()): "this_2m" | "last_2m" | "this_month" | "last_month" | null {
  const mode = filingMode(p);
  if (!mode) return null;
  const iso = toIsraelDate(today);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (mode === "month") {
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    if (p === `${year}-${pad2(month)}`) return "this_month";
    if (p === `${prevYear}-${pad2(prevMonth)}`) return "last_month";
    return null;
  }
  const b = Math.ceil(month / 2);
  if (p === `${year}-B${b}`) return "this_2m";
  if (p === (b === 1 ? `${year - 1}-B6` : `${year}-B${b - 1}`)) return "last_2m";
  return null;
}

/**
 * Deadlines for a period ending on `rangeEnd`. The statutory date is the 15th
 * of the next month; reporting AND paying online on the Tax Authority's site
 * extends it to the 19th, and a דיווח מפורט (PCN874) filer gets the 23rd.
 * When a date falls on a holiday or rest day the Authority publishes a shifted
 * calendar each year; the page says so rather than guessing the shift.
 */
export interface FilingDeadlines {
  regular: string;
  online: string;
  detailed: string;
}

export function filingDeadlines(rangeEnd: string): FilingDeadlines {
  const [y, m] = rangeEnd.split("-").map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = pad2(m === 12 ? 1 : m + 1);
  return { regular: `${year}-${month}-15`, online: `${year}-${month}-19`, detailed: `${year}-${month}-23` };
}

/** One line of the "what to type" list, whole shekels. */
export interface FilingFigure {
  key: string;
  label: string;
  value: number;
  /** Display override for non-money figures (the advance rate). */
  display?: string;
  hint?: string;
}

export interface IncomeRow {
  id: string;
  date: string;
  type: InvoiceDocument["type"];
  typeLabel: string;
  number: number;
  clientName: string;
  status: InvoiceDocument["status"];
  /** ₪ before VAT. Credit notes are stored negative and stay negative here. */
  net: number;
  vat: number;
  gross: number;
  /** A tax document (tax invoice, tax invoice-receipt, credit note): part of the VAT return. */
  inVat: boolean;
  /** Part of the advance turnover: marked paid (or a credit note) and not converted into another document. */
  inTurnover: boolean;
}

export interface MoneyTotals {
  count: number;
  net: number;
  vat: number;
  gross: number;
}

export interface PeriodicFiling {
  period: Period;
  range: FilingRange;
  ended: boolean;
  /** Whether the business files a periodic VAT return at all (מורשה / חברה). */
  filesVat: boolean;
  /** The PCN874 result the six figures came from; null for an עוסק פטור. */
  pcn: Pcn874Result | null;
  /** The six VAT-return figures; null for an עוסק פטור, who files none. */
  vat: VatReturnFigures | null;
  vatFigures: FilingFigure[];
  /** Input VAT left out of the figures because the supplier invoice has no allocation number. */
  excludedInputVat: number;
  /** Expenses with VAT whose category says ציוד but that are not marked as equipment. */
  equipmentCategoryUnmarked: number;
  advance: AdvanceComputation;
  advanceFigures: FilingFigure[];
  income: {
    rows: IncomeRow[];
    /** Every listed row. Counts an invoice and the receipt it became twice, so only an עוסק פטור sees it. */
    all: MoneyTotals;
    /** Rows that feed the VAT return. */
    vat: MoneyTotals;
    /** Rows that feed the advance turnover. */
    turnover: MoneyTotals;
  };
  expenses: ExpenseReport;
  deadlines: FilingDeadlines;
}

const VAT_DOC_TYPES = new Set<InvoiceDocument["type"]>(["tax_invoice", "tax_invoice_receipt", "credit_note"]);
const INCOME_DOC_TYPES = new Set<InvoiceDocument["type"]>(["receipt", "tax_invoice", "tax_invoice_receipt", "credit_note"]);

const emptyTotals = (): MoneyTotals => ({ count: 0, net: 0, vat: 0, gross: 0 });
function addTo(t: MoneyTotals, r: IncomeRow) {
  t.count += 1;
  t.net += r.net;
  t.vat += r.vat;
  t.gross += r.gross;
}
const cents = (n: number) => Math.round(n * 100) / 100;
const rounded = (t: MoneyTotals): MoneyTotals => ({ count: t.count, net: cents(t.net), vat: cents(t.vat), gross: cents(t.gross) });

function incomeRows(documents: InvoiceDocument[], range: FilingRange): PeriodicFiling["income"] {
  const rows: IncomeRow[] = [];
  const all = emptyTotals();
  const vat = emptyTotals();
  const turnover = emptyTotals();
  for (const d of documents) {
    if (d.date < range.start || d.date > range.end) continue;
    if (d.status === "draft" || d.status === "cancelled") continue;
    if (!INCOME_DOC_TYPES.has(d.type)) continue;
    // A tax invoice converted into a receipt stays a VAT event (the return
    // counts the invoice), so it is listed even though isCountableRevenue
    // drops it; the receipt it became carries the turnover instead.
    const row: IncomeRow = {
      id: d.id,
      date: d.date,
      type: d.type,
      typeLabel: DOCUMENT_TYPE_LABELS[d.type],
      number: d.number,
      clientName: d.clientName,
      status: d.status,
      net: d.subtotalIls ?? d.subtotal,
      vat: d.vatIls ?? d.vat,
      gross: d.totalIls ?? d.total,
      inVat: VAT_DOC_TYPES.has(d.type),
      inTurnover: countsForTurnover(d),
    };
    rows.push(row);
    addTo(all, row);
    if (row.inVat) addTo(vat, row);
    if (row.inTurnover) addTo(turnover, row);
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number));
  return { rows, all: rounded(all), vat: rounded(vat), turnover: rounded(turnover) };
}

export function buildPeriodicFiling(args: {
  business: Pick<Business, "taxId" | "businessType" | "incomeTaxAdvanceRate">;
  documents: InvoiceDocument[];
  expenses: Expense[];
  period: Period;
  today?: Date;
}): PeriodicFiling | null {
  const { business, documents, expenses, period } = args;
  const today = args.today ?? new Date();
  const range = filingRange(period);
  if (!range) return null;

  const filesVat = business.businessType === "authorized" || business.businessType === "company";

  // The same generator that writes the PCN874 file produces the six form
  // figures, so this page and /reports/vat always agree to the shekel.
  const pcn = filesVat ? buildPcn874({ business, documents, expenses, range, generatedOn: today }) : null;
  const vat = pcn?.figures ?? null;
  const vatFigures: FilingFigure[] = vat
    ? [
        { key: "taxable", label: "עסקאות חייבות (ללא מע״מ)", value: vat.taxableSales },
        { key: "output", label: "מס עסקאות", value: vat.outputVat },
        { key: "zero", label: "עסקאות פטורות או בשיעור אפס", value: vat.zeroOrExemptSales },
        { key: "equip", label: "מס תשומות ציוד", value: vat.equipmentInputVat },
        { key: "other", label: "מס תשומות אחרות", value: vat.otherInputVat },
        {
          key: "net",
          label: vat.netDue < 0 ? "סה״כ להחזר" : "סה״כ לתשלום",
          value: Math.abs(vat.netDue),
          hint: vat.netDue < 0 ? "התשומות עולות על העסקאות" : undefined,
        },
      ]
    : [];
  const excludedInputVat = (pcn?.warnings ?? []).reduce((sum, w) => sum + (w.excludedVat ?? 0), 0);

  const advance = computeAdvance(documents, range, business.incomeTaxAdvanceRate ?? 0);
  const advanceFigures: FilingFigure[] = [
    {
      key: "turnover",
      label: "מחזור עסקאות בתקופה (ללא מע״מ)",
      value: advance.turnover,
      hint: `לפי ${advance.docCount} מסמכים מהתקופה שסומנו כשולמו, וחשבוניות זיכוי`,
    },
    { key: "rate", label: "אחוז המקדמה", value: advance.ratePercent, display: `${advance.ratePercent}%` },
    { key: "advance", label: "סכום המקדמה", value: advance.advance },
    { key: "offset", label: "ניכוי מס במקור בתקופה (ניתן לקיזוז)", value: advance.offset },
    { key: "due", label: "לתשלום", value: advance.due },
  ];

  const expenseReport = buildExpenseReport(expenses, { period, category: "", kind: "all" });
  const equipmentCategoryUnmarked = filesVat
    ? expenseReport.rows.filter((r) => !r.isEquipment && r.vat > 0 && r.category.includes("ציוד")).length
    : 0;

  return {
    period,
    range,
    ended: filingPeriodEnded(period, today),
    filesVat,
    pcn,
    vat,
    vatFigures,
    excludedInputVat,
    equipmentCategoryUnmarked,
    advance,
    advanceFigures,
    income: incomeRows(documents, range),
    expenses: expenseReport,
    deadlines: filingDeadlines(range.end),
  };
}

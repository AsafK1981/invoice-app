// דוח תקופתי לרשות המסים - one report for the periodic filing.
//
// The Tax Authority's periodic filing ("דיווח ותשלום דוח תקופתי") is one
// submission per month or bi-month that carries both sides of the business:
// the VAT return (עסקאות = income, תשומות = expenses, six figures) and the
// income-tax advance (מקדמה: turnover × rate). The app already computes
// every one of those figures (src/lib/ita/pcn874.ts, income-tax-advances.ts,
// expense-report.ts); this module composes them for ONE period so the
// screen shows, in filing order, what to type and the income and expense
// rows the figures are made of. Nothing here recomputes tax logic - each
// number comes from the same generator that feeds the dedicated reports, so
// this page can never disagree with /reports/vat or /reports/advances.

import type { Business, Expense, InvoiceDocument } from "./types";
import { DOCUMENT_TYPE_LABELS, isCountableRevenue } from "./types";
import { buildPcn874, type VatReturnFigures } from "./ita/pcn874";
import { advanceDueDate, computeAdvance, countsForTurnover, type AdvanceComputation } from "./ita/income-tax-advances";
import { buildExpenseReport, type ExpenseReport } from "./expense-report";
import { periodLabel, periodMode, type Period } from "./report-period";
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

/** Only a month or a bi-month can be filed; anything else is not a filing period. */
export function isFilingPeriod(p: Period): boolean {
  const mode = periodMode(p);
  return mode === "month" || mode === "bimonth";
}

/**
 * The calendar bounds of a filing period. Unlike report-period's
 * `periodRange`, the end is NOT clipped to today: the form is about the
 * whole period, and the "has it ended yet" question is asked separately.
 */
export function filingRange(p: Period): FilingRange | null {
  if (!isFilingPeriod(p)) return null;
  const year = parseInt(p.slice(0, 4), 10);
  let from: number;
  let to: number;
  if (periodMode(p) === "bimonth") {
    const b = parseInt(p.slice(-1), 10);
    from = b * 2 - 1;
    to = b * 2;
  } else {
    from = parseInt(p.slice(5, 7), 10);
    to = from;
  }
  const lastDay = new Date(year, to, 0).getDate();
  return {
    start: `${year}-${pad2(from)}-01`,
    end: `${year}-${pad2(to)}-${pad2(lastDay)}`,
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
  const year = parseInt(iso.slice(0, 4), 10);
  const month = parseInt(iso.slice(5, 7), 10);
  const currentB = Math.ceil(month / 2);
  return currentB === 1 ? `${year - 1}-B6` : `${year}-B${currentB - 1}`;
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
  typeLabel: string;
  number: number;
  clientName: string;
  status: InvoiceDocument["status"];
  /** ₪ before VAT. Credit notes are stored negative and stay negative here. */
  net: number;
  vat: number;
  gross: number;
  /** Counted in the VAT return (a tax document, by issue date). */
  inVat: boolean;
  /** Counted in the advance turnover (paid in the period, or a credit note). */
  inTurnover: boolean;
}

export interface IncomeTotals {
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
  /** The six VAT-return figures; null for an עוסק פטור, who files none. */
  vat: VatReturnFigures | null;
  vatFigures: FilingFigure[];
  advance: AdvanceComputation;
  advanceFigures: FilingFigure[];
  income: { rows: IncomeRow[]; totals: IncomeTotals };
  expenses: ExpenseReport;
  /** ISO date: the 15th of the month after the period, for both filings. */
  dueDate: string;
}

const VAT_DOC_TYPES = new Set<InvoiceDocument["type"]>(["tax_invoice", "tax_invoice_receipt", "credit_note"]);

function incomeRows(documents: InvoiceDocument[], range: FilingRange): { rows: IncomeRow[]; totals: IncomeTotals } {
  const rows: IncomeRow[] = [];
  const totals: IncomeTotals = { count: 0, net: 0, vat: 0, gross: 0 };
  for (const d of documents) {
    if (d.date < range.start || d.date > range.end) continue;
    if (d.status === "draft" || d.status === "cancelled") continue;
    if (!isCountableRevenue(d)) continue;
    const net = d.subtotalIls ?? d.subtotal;
    const vat = d.vatIls ?? d.vat;
    const gross = d.totalIls ?? d.total;
    rows.push({
      id: d.id,
      date: d.date,
      typeLabel: DOCUMENT_TYPE_LABELS[d.type],
      number: d.number,
      clientName: d.clientName,
      status: d.status,
      net,
      vat,
      gross,
      inVat: VAT_DOC_TYPES.has(d.type),
      inTurnover: countsForTurnover(d),
    });
    totals.count += 1;
    totals.net += net;
    totals.vat += vat;
    totals.gross += gross;
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number));
  return { rows, totals };
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
  const vat = filesVat ? buildPcn874({ business, documents, expenses, range }).figures : null;
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

  const advance = computeAdvance(documents, range, business.incomeTaxAdvanceRate ?? 0);
  const advanceFigures: FilingFigure[] = [
    {
      key: "turnover",
      label: "מחזור עסקאות בתקופה (ללא מע״מ)",
      value: advance.turnover,
      hint: `על ${advance.docCount} מסמכים ששולמו בתקופה`,
    },
    { key: "rate", label: "אחוז המקדמה", value: advance.ratePercent, display: `${advance.ratePercent}%` },
    { key: "advance", label: "סכום המקדמה", value: advance.advance },
    { key: "offset", label: "ניכוי מס במקור בתקופה (ניתן לקיזוז)", value: advance.offset },
    { key: "due", label: "לתשלום", value: advance.due },
  ];

  return {
    period,
    range,
    ended: filingPeriodEnded(period, today),
    filesVat,
    vat,
    vatFigures,
    advance,
    advanceFigures,
    income: incomeRows(documents, range),
    expenses: buildExpenseReport(expenses, { period, category: "", kind: "all" }),
    dueDate: advanceDueDate(range.end),
  };
}

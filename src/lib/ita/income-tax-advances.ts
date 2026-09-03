// מקדמות מס הכנסה - the advance income-tax payment a self-employed person
// files on the 15th of the month (or bi-monthly, per the פנקס מקדמות the
// assessing office sends). There is no file to upload: the Tax Authority's
// online service asks for the period's turnover, applies the percentage the
// office set for the business, and lets the filer offset tax customers
// already withheld at source (ניכוי מס במקור). This module produces exactly
// those figures so they can be typed in, plus the deadline.
//
// Turnover basis: the app's revenue rule everywhere is "paid + countable",
// i.e. cash basis, which is how most freelancers keep their books. Turnover
// for מקדמות is BEFORE VAT (the VAT itself is reported to מע"מ, not to
// מס הכנסה), and credit notes reduce it - they are stored negative already.
// A credit note is never "paid" (the editor saves it as "sent"), so it is
// counted whenever it is issued, not by status.

import { isCountableRevenue, type InvoiceDocument } from "../types";

export interface PeriodTurnover {
  /** ₪ before VAT, whole shekels, credit notes netted. */
  turnover: number;
  /** ₪ withheld at source by customers on receipts in the period, whole shekels. */
  withheld: number;
  docCount: number;
}

/** Half-up to whole shekels, the way every מס הכנסה form is filled. */
export function roundShekelHalfUp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.floor(Math.abs(value) + 0.5 + Number.EPSILON);
  return value < 0 ? -magnitude : magnitude;
}

function countsForTurnover(d: InvoiceDocument): boolean {
  if (!isCountableRevenue(d)) return false;
  if (d.status === "draft" || d.status === "cancelled") return false;
  // Credit notes are stored negative and saved as "sent"; they reduce the
  // turnover of the period they were issued in.
  if (d.type === "credit_note") return true;
  return d.status === "paid";
}

export function periodTurnover(
  documents: InvoiceDocument[],
  range: { start: string; end: string },
): PeriodTurnover {
  let turnover = 0;
  let withheld = 0;
  let docCount = 0;
  for (const d of documents) {
    if (!countsForTurnover(d)) continue;
    if (d.date < range.start || d.date > range.end) continue;
    turnover += d.subtotalIls ?? d.subtotal;
    // Withholding is recorded in the document currency; the ILS snapshot
    // rate converts it the same way the header amounts were converted.
    withheld += (d.withholdingAmount ?? 0) * (d.exchangeRate ?? 1);
    docCount += 1;
  }
  return { turnover: roundShekelHalfUp(turnover), withheld: roundShekelHalfUp(withheld), docCount };
}

export interface AdvanceComputation extends PeriodTurnover {
  ratePercent: number;
  /** turnover × rate, whole shekels. */
  advance: number;
  /** Withholding that can be offset this period (capped at the advance). */
  offset: number;
  /** What is actually paid on the 15th. */
  due: number;
  /** Withholding above the advance; it is not lost, it comes back in the annual return. */
  carriedToAnnual: number;
}

export function computeAdvance(
  documents: InvoiceDocument[],
  range: { start: string; end: string },
  ratePercent: number,
): AdvanceComputation {
  const base = periodTurnover(documents, range);
  const rate = Number.isFinite(ratePercent) && ratePercent > 0 ? ratePercent : 0;
  // A period that nets negative (refunds above sales) has nothing to advance on.
  const turnover = Math.max(0, base.turnover);
  const advance = roundShekelHalfUp((turnover * rate) / 100);
  const offset = Math.min(base.withheld, advance);
  return {
    ...base,
    turnover,
    ratePercent: rate,
    advance,
    offset,
    due: advance - offset,
    carriedToAnnual: base.withheld - offset,
  };
}

/**
 * The statutory due date for a period ending on `rangeEnd` (ISO date): the
 * 15th of the following month. Returned as an ISO date.
 */
export function advanceDueDate(rangeEnd: string): string {
  const [y, m] = rangeEnd.split("-").map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const year = m === 12 ? y + 1 : y;
  return `${year}-${String(nextMonth).padStart(2, "0")}-15`;
}

/**
 * הצהרת עוסק פטור - the one figure an exempt dealer declares every year
 * (by 31 January for the previous calendar year): total turnover. The
 * declaration is a web form on the Tax Authority's site, not a file.
 *
 * Same definition as the dashboard's ceiling tracker: every countable
 * document ISSUED in the year (not only paid ones), at its total - the Tax
 * Authority's מחזור עסקאות is what was transacted, not what was collected.
 * An exempt dealer has no VAT, so total and pre-VAT amount coincide.
 */
export function exemptDealerAnnualTurnover(documents: InvoiceDocument[], year: number): PeriodTurnover {
  const prefix = `${year}-`;
  let turnover = 0;
  let withheld = 0;
  let docCount = 0;
  for (const d of documents) {
    if (!d.date.startsWith(prefix)) continue;
    if (d.status === "draft" || d.status === "cancelled") continue;
    if (!isCountableRevenue(d)) continue;
    turnover += d.totalIls ?? d.total;
    withheld += (d.withholdingAmount ?? 0) * (d.exchangeRate ?? 1);
    docCount += 1;
  }
  return { turnover: roundShekelHalfUp(turnover), withheld: roundShekelHalfUp(withheld), docCount };
}

export function exemptDeclarationDeadline(year: number): string {
  return `${year + 1}-01-31`;
}

// Israeli reporting periods, shared by every "what do I type into the Tax
// Authority form" report. Both מע"מ (דוח תקופתי) and מס הכנסה (מקדמות) run on
// the same calendar: a monthly filer reports one month, a bi-monthly filer
// reports Jan-Feb / Mar-Apr / May-Jun / Jul-Aug / Sep-Oct / Nov-Dec.
//
// Extracted from vat-period-report.tsx so the מקדמות report uses the exact
// same period arithmetic instead of a second, drifting copy.

export interface ReportRange {
  /** Inclusive ISO date. */
  start: string;
  /** Inclusive ISO date. */
  end: string;
  /** Hebrew label, e.g. "ינואר-פברואר 2026". */
  label: string;
}

export const MONTH_NAMES_HE = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Last calendar day of a 0-based month. */
function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/**
 * A bi-monthly VAT period. `offsetPeriods` 0 = the period containing
 * `reference`, -1 = the one before it, and it wraps years in both directions.
 */
export function biMonthlyRange(reference: Date, offsetPeriods: number): ReportRange {
  const refPeriodIndex = Math.floor(reference.getMonth() / 2);

  let targetIndex = refPeriodIndex + offsetPeriods;
  let targetYear = reference.getFullYear();
  while (targetIndex < 0) {
    targetIndex += 6;
    targetYear -= 1;
  }
  while (targetIndex > 5) {
    targetIndex -= 6;
    targetYear += 1;
  }

  const startMonth = targetIndex * 2; // 0-based
  const endMonth = startMonth + 1;
  return {
    start: `${targetYear}-${pad(startMonth + 1)}-01`,
    end: `${targetYear}-${pad(endMonth + 1)}-${pad(lastDayOfMonth(targetYear, endMonth))}`,
    label: `${MONTH_NAMES_HE[startMonth]}-${MONTH_NAMES_HE[endMonth]} ${targetYear}`,
  };
}

/** A single calendar month. `offset` 0 = the month containing `reference`. */
export function singleMonthRange(reference: Date, offset: number): ReportRange {
  const d = new Date(reference.getFullYear(), reference.getMonth() + offset, 1);
  const y = d.getFullYear();
  const m = d.getMonth();
  return {
    start: `${y}-${pad(m + 1)}-01`,
    end: `${y}-${pad(m + 1)}-${pad(lastDayOfMonth(y, m))}`,
    label: `${MONTH_NAMES_HE[m]} ${y}`,
  };
}

/** The calendar year containing `reference`. */
export function yearRange(reference: Date): ReportRange {
  const y = reference.getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31`, label: `שנת ${y}` };
}

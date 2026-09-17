/**
 * Income against expenses over time, for the chart on /admin/budget.
 *
 * Pure, like admin-budget.ts, and built on the same two rules: a NULL amount is
 * a hole (skipped, never a zero) and money is rounded once, at the end.
 *
 * WHERE EACH SHEKEL LANDS
 *
 *  - A real payment in (Grow / Polar) lands on its Israel calendar day.
 *  - A one-off row, and a yearly INCOME row, lands on its `entry_date`. With no
 *    date it cannot be placed and is left out, the same way the summary cards
 *    leave it out of the month.
 *  - A recurring expense (monthly, or yearly / 12) and a monthly income row are
 *    ACCRUED: each day carries rate / days-in-that-month, so the days of a month
 *    add up to exactly the "הוצאה חודשית" card, a week is its seven days, and a
 *    year is its months. The budget table stores a price, not a payment
 *    history, so there is no charge date to pin a recurring cost to; spreading
 *    it is the only reading that agrees with the cards at every zoom level.
 *
 * Two honest limits, both said on the page:
 *  - Past periods use TODAY's prices. The table does not know what a vendor
 *    cost in May, only what it costs now.
 *  - Nothing is accrued before BUDGET_EPOCH. Projecting a run-rate onto months
 *    when the app did not exist would invent costs that were never paid.
 */

import { todayInIsrael } from "./date";
import {
  DEFAULT_USD_RATE,
  israelDayOf,
  roundMoney,
  type AutomaticIncome,
  type BudgetEntry,
} from "./admin-budget";

export type BudgetChartGranularity = "day" | "week" | "month" | "year";

export const BUDGET_CHART_GRANULARITIES: { key: BudgetChartGranularity; label: string }[] = [
  { key: "day", label: "יום" },
  { key: "week", label: "שבוע" },
  { key: "month", label: "חודש" },
  { key: "year", label: "שנה" },
];

/** The month the app went live (first commit 2026-04-15). Nothing accrues before it. */
export const BUDGET_EPOCH = "2026-04-01";

/** How many points each view shows. The year view shows at least this many years. */
const DAY_POINTS = 30;
const WEEK_POINTS = 12;
const MONTH_POINTS = 12;
const MIN_YEAR_POINTS = 3;
const MAX_YEAR_POINTS = 6;

const HEBREW_MONTHS_SHORT = [
  "ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יונ׳",
  "יול׳", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳",
];

export interface BudgetChartPoint {
  label: string;
  /** First and last calendar day of the bucket, "YYYY-MM-DD", inclusive. */
  start: string;
  end: string;
  income: number;
  expense: number;
}

export interface BudgetChartOptions {
  /** "YYYY-MM-DD"; defaults to today in Israel. */
  today?: string;
  /** USD -> ILS; defaults to DEFAULT_USD_RATE. */
  usdRate?: number;
}

// Calendar days are handled as "YYYY-MM-DD" strings and moved with UTC maths,
// so the machine's own timezone can never shift a day across a boundary.

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, count: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + count);
  return formatDay(date);
}

function daysInMonthOf(day: string): number {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function lastDayOfMonth(day: string): string {
  return `${day.slice(0, 8)}${String(daysInMonthOf(day)).padStart(2, "0")}`;
}

function shortDayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d}.${m}`;
}

function buildBuckets(
  granularity: BudgetChartGranularity,
  today: string,
  earliestYear: number,
): { label: string; start: string; end: string }[] {
  const buckets: { label: string; start: string; end: string }[] = [];
  const [year, month] = today.split("-").map(Number);

  if (granularity === "day") {
    for (let i = DAY_POINTS - 1; i >= 0; i--) {
      const day = addDays(today, -i);
      buckets.push({ label: shortDayLabel(day), start: day, end: day });
    }
    return buckets;
  }

  if (granularity === "week") {
    // Weeks start on Sunday, the Israeli week. Labelled by their first day.
    const thisSunday = addDays(today, -parseDay(today).getUTCDay());
    for (let i = WEEK_POINTS - 1; i >= 0; i--) {
      const start = addDays(thisSunday, -7 * i);
      buckets.push({ label: shortDayLabel(start), start, end: addDays(start, 6) });
    }
    return buckets;
  }

  if (granularity === "month") {
    for (let i = MONTH_POINTS - 1; i >= 0; i--) {
      const first = new Date(Date.UTC(year, month - 1 - i, 1));
      const start = formatDay(first);
      const name = HEBREW_MONTHS_SHORT[first.getUTCMonth()];
      // The year is spelled out only where the window crosses a January.
      const label = first.getUTCFullYear() === year
        ? name
        : `${name} ${String(first.getUTCFullYear()).slice(2)}`;
      buckets.push({ label, start, end: lastDayOfMonth(start) });
    }
    return buckets;
  }

  const count = Math.min(
    MAX_YEAR_POINTS,
    Math.max(MIN_YEAR_POINTS, year - earliestYear + 1),
  );
  for (let i = count - 1; i >= 0; i--) {
    const y = year - i;
    buckets.push({ label: String(y), start: `${y}-01-01`, end: `${y}-12-31` });
  }
  return buckets;
}

/** Amount in ILS that counts, or null for a hole. Mirrors countableAmount. */
function ilsAmount(entry: BudgetEntry, usdRate: number): number | null {
  if (entry.is_free) return 0;
  if (entry.amount === null || entry.amount === undefined) return null;
  if (!Number.isFinite(entry.amount)) return null;
  return entry.currency === "USD" ? entry.amount * usdRate : entry.amount;
}

export function buildBudgetChart(
  entries: BudgetEntry[],
  automatic: AutomaticIncome[],
  granularity: BudgetChartGranularity,
  options: BudgetChartOptions = {},
): BudgetChartPoint[] {
  const today = options.today ?? todayInIsrael();
  const usdRate = Number.isFinite(options.usdRate) && (options.usdRate as number) > 0
    ? (options.usdRate as number)
    : DEFAULT_USD_RATE;

  // Money that lands on one day, and the two monthly rates that are accrued.
  const incomeByDay = new Map<string, number>();
  const expenseByDay = new Map<string, number>();
  let monthlyExpenseRate = 0;
  let monthlyIncomeRate = 0;
  const add = (map: Map<string, number>, day: string, value: number) =>
    map.set(day, (map.get(day) ?? 0) + value);

  for (const entry of entries) {
    if (!entry.active) continue;
    const amount = ilsAmount(entry, usdRate);
    if (amount === null) continue;

    if (entry.kind === "expense") {
      if (entry.recurrence === "monthly") monthlyExpenseRate += amount;
      else if (entry.recurrence === "yearly") monthlyExpenseRate += amount / 12;
      else if (entry.entry_date) add(expenseByDay, entry.entry_date, amount);
      continue;
    }
    if (entry.recurrence === "monthly") monthlyIncomeRate += amount;
    else if (entry.entry_date) add(incomeByDay, entry.entry_date, amount);
  }

  for (const row of automatic) {
    const day = israelDayOf(row.charged_at);
    const amount = Number(row.amount);
    if (!day || !Number.isFinite(amount)) continue;
    add(incomeByDay, day, row.currency === "USD" ? amount * usdRate : amount);
  }

  // Accrual stops where the comparison stops being fair. Day and week views
  // end today. The month view counts the WHOLE current month, because that is
  // what the "הוצאה חודשית" card beside it shows, and the year view follows the
  // month view so that a year is always the sum of its months.
  const accrualEnd =
    granularity === "day" || granularity === "week" ? today : lastDayOfMonth(today);

  let earliestYear = Number(BUDGET_EPOCH.slice(0, 4));
  for (const day of [...incomeByDay.keys(), ...expenseByDay.keys()]) {
    const y = Number(day.slice(0, 4));
    if (Number.isFinite(y) && y < earliestYear) earliestYear = y;
  }

  return buildBuckets(granularity, today, earliestYear).map((bucket) => {
    let income = 0;
    let expense = 0;
    for (const [day, value] of incomeByDay) {
      if (day >= bucket.start && day <= bucket.end) income += value;
    }
    for (const [day, value] of expenseByDay) {
      if (day >= bucket.start && day <= bucket.end) expense += value;
    }

    const from = bucket.start > BUDGET_EPOCH ? bucket.start : BUDGET_EPOCH;
    const to = bucket.end < accrualEnd ? bucket.end : accrualEnd;
    if (from <= to && (monthlyExpenseRate > 0 || monthlyIncomeRate > 0)) {
      // Whole months at once where possible, so a month is exactly its rate and
      // not thirty rounded slices of it.
      let cursor = from;
      while (cursor <= to) {
        const monthEnd = lastDayOfMonth(cursor);
        const sliceEnd = monthEnd < to ? monthEnd : to;
        const days = Number(sliceEnd.slice(8)) - Number(cursor.slice(8)) + 1;
        const share = days / daysInMonthOf(cursor);
        expense += monthlyExpenseRate * share;
        income += monthlyIncomeRate * share;
        cursor = addDays(sliceEnd, 1);
      }
    }

    return {
      ...bucket,
      income: roundMoney(income),
      expense: roundMoney(expense),
    };
  });
}

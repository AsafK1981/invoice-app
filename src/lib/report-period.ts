/**
 * The reports page period model. A period is a compact string:
 *   "all"        every document ever
 *   "2026"       a calendar year
 *   "2026-Q3"    a quarter (Jul-Sep)
 *   "2026-08"    a month
 * Pure helpers, no React, so the page, the exports and the tests share one
 * definition of "what does August 2026 mean".
 */

import { toIsraelDate } from "./date";
import { formatMonth } from "./format";

export type PeriodMode = "month" | "quarter" | "year" | "all";
export type Period = string;

export const HEBREW_MONTHS_SHORT = [
  "ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יונ׳",
  "יול׳", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳",
];

export const PERIOD_MODE_LABELS: Record<PeriodMode, string> = {
  month: "חודש",
  quarter: "רבעון",
  year: "שנה",
  all: "הכל",
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export function periodMode(p: Period): PeriodMode {
  if (p === "all") return "all";
  if (/^\d{4}$/.test(p)) return "year";
  if (/^\d{4}-Q[1-4]$/.test(p)) return "quarter";
  return "month";
}

/** Year the period lives in, or null for "all". */
export function periodYear(p: Period): number | null {
  return /^\d{4}/.test(p) ? parseInt(p.slice(0, 4), 10) : null;
}

/** First and last month numbers (1-12) covered by the period. */
function monthSpan(p: Period): [number, number] {
  switch (periodMode(p)) {
    case "year":
      return [1, 12];
    case "quarter": {
      const q = parseInt(p.slice(-1), 10);
      return [(q - 1) * 3 + 1, q * 3];
    }
    case "month": {
      const m = parseInt(p.slice(5, 7), 10);
      return [m, m];
    }
    default:
      return [1, 12];
  }
}

export function periodMatches(p: Period, date: string): boolean {
  if (p === "all") return true;
  const y = periodYear(p);
  if (y === null || !date.startsWith(String(y))) return false;
  const m = parseInt(date.slice(5, 7), 10);
  const [from, to] = monthSpan(p);
  return m >= from && m <= to;
}

export function periodLabel(p: Period): string {
  switch (periodMode(p)) {
    case "all":
      return "כל הזמנים";
    case "year":
      return `שנת ${p}`;
    case "quarter": {
      const y = periodYear(p);
      const q = parseInt(p.slice(-1), 10);
      const [from, to] = monthSpan(p);
      return `רבעון ${q} · ${y} (${HEBREW_MONTHS_SHORT[from - 1]}-${HEBREW_MONTHS_SHORT[to - 1]})`;
    }
    case "month":
      return monthLabel(p);
  }
}

/** The stepper's centre label: "2026" / "רבעון 3 · 2026" / "אוגוסט 2026". */
export function periodStepLabel(p: Period): string {
  switch (periodMode(p)) {
    case "all":
      return "כל הזמנים";
    case "year":
      return p;
    case "quarter":
      return `רבעון ${p.slice(-1)} · ${periodYear(p)}`;
    case "month":
      return monthLabel(p);
  }
}

/** Move one unit forward (+1) or back (-1). "all" has nowhere to go. */
export function shiftPeriod(p: Period, delta: 1 | -1): Period {
  const y = periodYear(p);
  if (y === null) return p;
  switch (periodMode(p)) {
    case "year":
      return String(y + delta);
    case "quarter": {
      const q = parseInt(p.slice(-1), 10) + delta;
      if (q < 1) return `${y - 1}-Q4`;
      if (q > 4) return `${y + 1}-Q1`;
      return `${y}-Q${q}`;
    }
    case "month": {
      const m = parseInt(p.slice(5, 7), 10) + delta;
      if (m < 1) return `${y - 1}-12`;
      if (m > 12) return `${y + 1}-01`;
      return `${y}-${pad2(m)}`;
    }
    default:
      return p;
  }
}

/**
 * Change the granularity while staying "where the user is": switching to
 * month inside 2026 lands on this month if 2026 is the current year,
 * otherwise on December of that year; switching to year keeps the year.
 */
export function switchMode(p: Period, mode: PeriodMode, today = new Date()): Period {
  if (mode === "all") return "all";
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const y = periodYear(p) ?? ty;
  const [from, to] = monthSpan(p);
  const holdsToday = y === ty && tm >= from && tm <= to;
  // Anchor month: the month the user is "in". Today's month when the
  // current period contains it (or when coming from "all"); the last month
  // of a past year; the first month of any other past/future period.
  let anchor: number;
  if (periodMode(p) === "all") anchor = tm;
  else if (holdsToday) anchor = tm;
  else if (periodMode(p) === "year") anchor = y < ty ? 12 : 1;
  else anchor = from;
  if (mode === "year") return String(y);
  if (mode === "quarter") return `${y}-Q${Math.ceil(anchor / 3)}`;
  return `${y}-${pad2(anchor)}`;
}

/** Inclusive ISO date range, with the end clipped to today for periods still in progress. */
export function periodRange(p: Period, today = new Date()): { start: string; end: string } | null {
  const y = periodYear(p);
  if (y === null) return null;
  const [from, to] = monthSpan(p);
  const start = `${y}-${pad2(from)}-01`;
  const lastDay = new Date(y, to, 0).getDate();
  const naturalEnd = `${y}-${pad2(to)}-${pad2(lastDay)}`;
  const t = toIsraelDate(today);
  return { start, end: naturalEnd < t ? naturalEnd : t };
}

/**
 * The same period one unit earlier, clipped to the same day-of-period, so a
 * year in progress compares Jan 1 - Aug 18 against Jan 1 - Aug 18 of last
 * year rather than against a full year.
 */
export function previousEquivalentRange(p: Period, today = new Date()): { start: string; end: string } | null {
  const range = periodRange(p, today);
  if (!range) return null;
  const prev = shiftPeriod(p, -1);
  const prevRange = periodRange(prev, new Date(8640000000000000));
  if (!prevRange) return null;
  const mode = periodMode(p);
  const [ey, em, ed] = range.end.split("-").map(Number);
  let end: Date;
  if (mode === "year") end = new Date(ey - 1, em - 1, 1);
  else if (mode === "quarter") end = new Date(ey, em - 4, 1);
  else end = new Date(ey, em - 2, 1);
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  end.setDate(Math.min(ed, lastDay));
  const clipped = toIsraelDate(end);
  return { start: prevRange.start, end: clipped < prevRange.end ? clipped : prevRange.end };
}

export function inRange(date: string, r: { start: string; end: string }): boolean {
  return date >= r.start && date <= r.end;
}

/** "YYYY-MM" for each of the 12 months of a year. */
export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad2(i + 1)}`);
}

/** The 12 months ending this month, oldest first. */
export function trailingMonths(count = 12, today = new Date()): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return out;
}

/** "אוגוסט 2026" for a "YYYY-MM" key, through the app's Intl month formatter. */
export function monthLabel(ym: string): string {
  return formatMonth(`${ym}-01`);
}

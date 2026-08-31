/**
 * The reports page period model. A period is a compact string:
 *   "all"        every document ever
 *   "2026"       a calendar year
 *   "2026-Q3"    a quarter (Jul-Sep)
 *   "2026-08"    a month
 *   "2026-01-05..2026-03-10"  a free date range (inclusive on both ends)
 * Pure helpers, no React, so the page, the exports and the tests share one
 * definition of "what does August 2026 mean".
 */

import { toIsraelDate } from "./date";
import { formatDate, formatMonth } from "./format";

export type PeriodMode = "month" | "quarter" | "year" | "range" | "all";
export type Period = string;

export const HEBREW_MONTHS_SHORT = [
  "ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יונ׳",
  "יול׳", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳",
];

export const PERIOD_MODE_LABELS: Record<PeriodMode, string> = {
  month: "חודש",
  quarter: "רבעון",
  year: "שנה",
  range: "טווח",
  all: "הכל",
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

/** ISO date `n` days after (or before, for negative `n`) an ISO date. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toIsraelDate(new Date(Date.UTC(y, m - 1, d + n, 12)));
}

/** Inclusive number of days from `start` to `end` ("2026-01-01".."2026-01-01" = 1). */
export function daysInclusive(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1;
}

/** Build a range period. Ends are swapped if given backwards. */
export function makeRange(start: string, end: string): Period {
  return start <= end ? `${start}..${end}` : `${end}..${start}`;
}

/** The inclusive bounds of a range period, or null for any other mode. */
export function rangeBounds(p: Period): { start: string; end: string } | null {
  const m = RANGE_RE.exec(p);
  return m ? { start: m[1], end: m[2] } : null;
}

export function periodMode(p: Period): PeriodMode {
  if (p === "all") return "all";
  if (/^\d{4}$/.test(p)) return "year";
  if (/^\d{4}-Q[1-4]$/.test(p)) return "quarter";
  if (RANGE_RE.test(p)) return "range";
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
  const bounds = rangeBounds(p);
  if (bounds) return inRange(date.slice(0, 10), bounds);
  const y = periodYear(p);
  if (y === null || !date.startsWith(String(y))) return false;
  const m = parseInt(date.slice(5, 7), 10);
  const [from, to] = monthSpan(p);
  return m >= from && m <= to;
}

/** "05.01.2026 - 10.03.2026" for a range period. */
function rangeLabel(p: Period): string {
  const b = rangeBounds(p)!;
  return `${formatDate(b.start)} - ${formatDate(b.end)}`;
}

export function periodLabel(p: Period): string {
  switch (periodMode(p)) {
    case "all":
      return "כל הזמנים";
    case "range":
      return rangeLabel(p);
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
    case "range":
      return rangeLabel(p);
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
  // A range slides by its own length: 05.01-10.03 steps back to the
  // equally long window that ends the day before 05.01.
  const b = rangeBounds(p);
  if (b) {
    const len = daysInclusive(b.start, b.end);
    return makeRange(addDays(b.start, delta * len), addDays(b.end, delta * len));
  }
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
  // Switching to a free range starts from the dates the user is already
  // looking at (a year in progress = Jan 1 to today); from "all" it starts
  // as the last 30 days, which is the range people most often want.
  if (mode === "range") {
    const cur = periodRange(p, today);
    if (cur) return makeRange(cur.start, cur.end);
    const t = toIsraelDate(today);
    return makeRange(addDays(t, -29), t);
  }
  const rb = rangeBounds(p);
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const y = periodYear(p) ?? ty;
  const [from, to] = monthSpan(p);
  const holdsToday = y === ty && tm >= from && tm <= to;
  // Anchor month: the month the user is "in". Today's month when the
  // current period contains it (or when coming from "all"); the last month
  // of a past year; the first month of any other past/future period.
  let anchor: number;
  if (rb) anchor = y === ty && inRange(toIsraelDate(today), rb) ? tm : parseInt(rb.start.slice(5, 7), 10);
  else if (periodMode(p) === "all") anchor = tm;
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
  const rb = rangeBounds(p);
  if (rb) {
    const t = toIsraelDate(today);
    return { start: rb.start, end: rb.end < t ? rb.end : t };
  }
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
  // A range compares against the equally long window ending the day before
  // it starts (the clipped length, so a range reaching past today is not
  // compared against a longer window than it actually covers).
  if (rangeBounds(p)) {
    if (range.end < range.start) return null;
    const len = daysInclusive(range.start, range.end);
    const end = addDays(range.start, -1);
    return { start: addDays(end, -(len - 1)), end };
  }
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

/**
 * Does the calendar month "YYYY-MM" touch the period? For a range this is an
 * overlap test (a range starting on the 20th still touches that month); for
 * every other mode a month is either wholly in or wholly out.
 */
export function periodMatchesMonth(p: Period, ym: string): boolean {
  const b = rangeBounds(p);
  if (b) return `${ym}-01` <= b.end && `${ym}-31` >= b.start;
  return periodMatches(p, `${ym}-01`);
}

/**
 * The months the reports chart lays out for a period, oldest first: the
 * trailing twelve for "all", the whole calendar year for a year / quarter /
 * month (the inactive months give the active ones context), and for a range
 * the calendar year it sits in - or, when it crosses a year boundary, exactly
 * the months it spans.
 */
export function periodChartMonths(p: Period, today = new Date()): string[] {
  const b = rangeBounds(p);
  if (b) {
    const sy = parseInt(b.start.slice(0, 4), 10);
    const ey = parseInt(b.end.slice(0, 4), 10);
    if (sy === ey) return monthsOfYear(sy);
    const out: string[] = [];
    let y = sy, m = parseInt(b.start.slice(5, 7), 10);
    const endYm = b.end.slice(0, 7);
    for (;;) {
      const ym = `${y}-${pad2(m)}`;
      out.push(ym);
      if (ym >= endYm) break;
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }
  const y = periodYear(p);
  return y === null ? trailingMonths(12, today) : monthsOfYear(y);
}

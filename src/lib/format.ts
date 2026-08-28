// Built once: Intl.NumberFormat construction (locale lookup) costs more than
// the format call itself, and the editor calls this a dozen times per render.
const ILS_WHOLE = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const ILS_CENTS = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return (amount % 1 === 0 ? ILS_WHOLE : ILS_CENTS).format(amount);
}

/**
 * A plain calendar date with no time part: "2026-07-05" (optionally with a
 * trailing time we ignore only when the caller asked for a date-only value).
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a date for display as DD.MM.YYYY (he-IL).
 *
 * Two kinds of input reach this function and they must NOT be treated alike:
 *
 * 1. Calendar dates ("YYYY-MM-DD"): document date, due date, period dates.
 *    `new Date("2026-07-05")` parses as UTC midnight, and formatting that in a
 *    runtime-local timezone west of UTC prints 04.07.2026. On a tax document
 *    that is a legal defect. These are formatted from their parts, with no
 *    Date object and no timezone conversion at all.
 *
 * 2. Instants (full ISO timestamps: emailed_at, paid_at, created_at…). These
 *    genuinely denote a moment in time, so they are rendered in Asia/Jerusalem
 *    (the users' timezone) instead of whatever timezone the runtime happens
 *    to be in (UTC on Vercel, local in the browser).
 */
export function formatDate(date: string): string {
  const parts = DATE_ONLY.exec(date);
  if (parts) {
    const [, year, month, day] = parts;
    return `${day}.${month}.${year}`;
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Jerusalem",
  }).format(parsed);
}

export function formatMonth(date: string): string {
  const parts = DATE_ONLY.exec(date);
  const parsed = parts ? new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3], 12)) : new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("he-IL", {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Jerusalem",
  }).format(parsed);
}

// Built once: Intl.NumberFormat construction (locale lookup) costs more than
// the format call itself, and the editor calls this a dozen times per render.
const NUM_WHOLE = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const NUM_CENTS = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Shekel sign + a small gap + already-formatted digits: "₪ 1,234".
 *
 * The sign ALWAYS sits to the left of the digits, in every context, and the
 * gap is a NARROW NO-BREAK SPACE (U+202F): a little visible air between the
 * sign and the number (Asaf, 2026-09-07: never glued together), narrower than
 * a word space, and unbreakable so the sign is never orphaned at a line end.
 * HarfBuzz synthesises it from the regular space glyph when a document font
 * lacks it, so it renders on the PDF fonts too.
 *
 * Why not the he-IL currency formatter: it emits "1,234 ₪" (sign after), and
 * the sign's visual side then depends on the surrounding direction - a Hebrew
 * RTL paragraph shows it on the left, but any dir="ltr" cell (report tables,
 * KPI tiles, tabular numbers) shows it on the right.
 *
 * Why the bidi isolate (U+2066 ... U+2069): "₪1,234" with no space was
 * bidi-stable on its own (a currency sign directly followed by digits is
 * treated as part of the number), but a space in between is a neutral that
 * the bidi algorithm resolves against its NEIGHBOURS, so inside a Hebrew
 * sentence the sign would jump to the far side and read "1,234 ₪". The
 * isolate turns the whole token into an LTR island, so the sign stays on the
 * left in Hebrew prose and in LTR cells alike. A leading minus goes INSIDE
 * the isolate for the same reason ("-₪ 1,234", never "₪ 1,234-").
 *
 * Every shekel amount a user can see is built through this helper
 * (formatCurrency, formatMoney for ILS, the tax-authority threshold, chart
 * ticks, WhatsApp/e-mail bodies, hard-coded marketing figures), so the
 * sign-side and gap convention lives in one place.
 */
export function shekel(digits: string, negative = false): string {
  return `\u2066${negative ? "-" : ""}₪\u202F${digits}\u2069`;
}

/**
 * ILS amount for display: "₪ 1,234.50" / "₪ 1,234" - see {@link shekel} for
 * the sign side, the gap and the bidi isolate. Whole amounts drop the cents.
 *
 * The output carries the invisible isolate marks. They render as nothing in
 * subjects, CSV cells, notification bodies and stored labels, but this is
 * display text: never parse it back into a number.
 */
export function formatCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const digits = (abs % 1 === 0 ? NUM_WHOLE : NUM_CENTS).format(abs);
  const isNegative = amount < 0 && /[1-9]/.test(digits);
  return shekel(digits, isNegative);
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
/**
 * Month names for the English document date. Written out rather than taken
 * from Intl so a calendar date is still formatted from its parts, with no Date
 * object and no timezone to shift it (reason 1 above applies in both languages).
 */
const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatDate(date: string, lang?: string): string {
  const english = lang === "en";
  const parts = DATE_ONLY.exec(date);
  if (parts) {
    const [, year, month, day] = parts;
    // An English document reads "5 Sep 2026": day-first like the Hebrew one
    // (so a reader of both sees the same order), month named so an American
    // reader cannot mistake 05.09 for the 9th of May.
    if (english) return `${Number(day)} ${MONTHS_EN[Number(month) - 1]} ${year}`;
    return `${day}.${month}.${year}`;
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  if (english) {
    // Resolve the instant to its Israeli calendar date first (en-CA formats as
    // "YYYY-MM-DD"), then print it from the parts above. Not Intl's own English
    // month name: locale data disagrees with itself ("Sep" vs "Sept" depending
    // on locale and ICU version), and a document must not change wording
    // between the browser and the PDF renderer.
    const iso = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Asia/Jerusalem",
    }).format(parsed);
    const isoParts = DATE_ONLY.exec(iso);
    if (isoParts) {
      const [, year, month, day] = isoParts;
      return `${Number(day)} ${MONTHS_EN[Number(month) - 1]} ${year}`;
    }
  }
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

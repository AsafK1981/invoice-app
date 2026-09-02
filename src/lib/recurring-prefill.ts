import type { DocumentType, InvoiceDocument } from "./types";

/**
 * Smart prefill for a fresh document: when a client gets the same document
 * month after month ("שכר דירה", "הופעות - חודש יולי 2026"), detect that
 * pattern in their history and propose the subject + line items, with the
 * period tokens (month name / MM/YYYY / year) rolled forward to the new
 * document's date. Pure functions - no fetching, no React.
 */

export const HEBREW_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

// "מרס" is a common alternate spelling of מרץ; accept it on input, emit מרץ.
const MONTH_ALIASES: Record<string, number> = { מרס: 2 };

const MONTH_NAME_PATTERN = [...HEBREW_MONTHS, ...Object.keys(MONTH_ALIASES)].join("|");

// A month token: an optional Hebrew prefix letter run (ב/ל/מ/ה/ו etc.),
// then a month name, then optionally a 4- or 2-digit year (with or without
// a separator like space, "/", ".", "-").
const MONTH_NAME_RE = new RegExp(
  `(^|[^\\u05d0-\\u05ea])([\\u05d0-\\u05ea]{0,2}?)(${MONTH_NAME_PATTERN})(?:([\\s./-]{0,3})(\\d{4}|\\d{2})(?!\\d))?(?![\\u05d0-\\u05ea])`,
  "g"
);

// A numeric period token: MM/YYYY, MM.YYYY, MM-YYYY, MM/YY (month 01-12).
// Not a full date (DD/MM/YYYY) - a full date is left untouched because we
// cannot know which day the user meant.
const NUMERIC_PERIOD_RE = /(^|[^\d/.-])(0?[1-9]|1[0-2])([/.-])(\d{4}|\d{2})(?![\d/.-])/g;

// A bare 4-digit year in the plausible range. Not one glued to a date
// separator ("15/08/2026") - that belongs to a full date we leave alone.
const BARE_YEAR_RE = /(^|[^\d/.-])((?:19|20)\d{2})(?!\d)/g;

export interface RecurringPrefillItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface RecurringPrefill {
  subject: string;
  items: RecurringPrefillItem[];
  /** The past document the proposal was rolled forward from. */
  source: { id: string; number: number; date: string; type: DocumentType };
  /** How many past documents share this recurring pattern. */
  occurrences: number;
}

function monthIndex(name: string): number {
  const i = (HEBREW_MONTHS as readonly string[]).indexOf(name);
  return i >= 0 ? i : MONTH_ALIASES[name] ?? -1;
}

/** Whole months between two ISO dates (yyyy-mm-dd), sign included. */
export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.split("-").map(Number);
  const [ty, tm] = toIso.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return 0;
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * Collapse a subject / description to what stays constant across months:
 * lowercase, month names + numeric periods + years + all digits stripped,
 * punctuation removed, whitespace collapsed. "שכר דירה - אוגוסט 2026" and
 * "שכר דירה - ספטמבר 2026" normalize to the same key.
 */
export function normalizePeriodicText(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(MONTH_NAME_RE, "$1")
    .replace(NUMERIC_PERIOD_RE, "$1")
    .replace(BARE_YEAR_RE, "$1")
    .replace(/\d+/g, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Roll every month token (Hebrew month name, MM/YYYY, MM/YY) in `text`
 * forward by `deltaMonths`. `anchorYear` is the year assumed for a month
 * name that carries no year of its own (the year of the document the text
 * was copied from). Bare years elsewhere in the text are not touched here.
 */
export function shiftMonthTokens(text: string, deltaMonths: number, anchorYear: number): string {
  if (!text || deltaMonths === 0) return text;
  const parseYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  const formatYear = (y: number, like: string) => (like.length === 2 ? String(y % 100).padStart(2, "0") : String(y));
  // (year, 0-based month) + delta -> { year, month (0-based) }
  const roll = (year: number, month0: number) => {
    const total = year * 12 + month0 + deltaMonths;
    return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
  };
  return text
    .replace(
      MONTH_NAME_RE,
      (m, lead: string, prefix: string, name: string, sep: string | undefined, year: string | undefined) => {
        const mi = monthIndex(name);
        if (mi < 0) return m;
        const r = roll(year ? parseYear(year) : anchorYear, mi);
        const newName = HEBREW_MONTHS[r.month0];
        return year ? `${lead}${prefix}${newName}${sep ?? ""}${formatYear(r.year, year)}` : `${lead}${prefix}${newName}`;
      }
    )
    .replace(NUMERIC_PERIOD_RE, (_m, lead: string, month: string, sep: string, year: string) => {
      const r = roll(parseYear(year), Number(month) - 1);
      const newMonth = month.length === 2 ? String(r.month0 + 1).padStart(2, "0") : String(r.month0 + 1);
      return `${lead}${newMonth}${sep}${formatYear(r.year, year)}`;
    });
}

/**
 * Roll a past document's text forward to a new document date. Month tokens
 * shift by the whole-month distance between the two dates (so "יולי" written
 * on a doc dated August becomes "אוגוסט" on a doc dated September - the
 * one-month lag is preserved). A bare year that equals the source document's
 * year follows the new document's year; years attached to a month token are
 * handled by the month shift and left alone here.
 */
export function rollTextForward(text: string, fromDate: string, toDate: string): string {
  if (!text) return text;
  const delta = monthsBetween(fromDate, toDate);
  const fromYear = Number(fromDate.slice(0, 4));
  const toYear = Number(toDate.slice(0, 4));

  // Protect month tokens (already carrying their own year) from the bare-year
  // pass by swapping them for placeholders first.
  const protectedTokens: string[] = [];
  const PLACEHOLDER = (i: number) => `\u0000${i}\u0000`;
  const masked = text
    .replace(MONTH_NAME_RE, (m) => {
      protectedTokens.push(m);
      return PLACEHOLDER(protectedTokens.length - 1);
    })
    .replace(NUMERIC_PERIOD_RE, (m) => {
      protectedTokens.push(m);
      return PLACEHOLDER(protectedTokens.length - 1);
    });

  const yearShifted =
    fromYear && toYear && fromYear !== toYear
      ? masked.replace(BARE_YEAR_RE, (_m, lead: string, y: string) =>
          Number(y) === fromYear ? `${lead}${toYear}` : _m
        )
      : masked;

  const restored = yearShifted.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => protectedTokens[Number(i)]);
  return shiftMonthTokens(restored, delta, fromYear || new Date().getFullYear());
}

/**
 * Signature of what stays constant across a client's recurring documents.
 * Structurally typed rather than Pick<InvoiceDocument, ...> so the cadence
 * detector (recurring-patterns.ts) can hand it the trimmed document shape it
 * reads out of the database, without inventing item ids and totals it does
 * not need.
 */
export function documentSignature(doc: {
  subject?: string | null;
  items?: { description?: string | null }[] | null;
}): string {
  const subject = normalizePeriodicText(doc.subject);
  const items = (doc.items || []).map((i) => normalizePeriodicText(i.description)).filter(Boolean);
  if (!subject && items.length === 0) return "";
  return `${subject}|${items.join("|")}`;
}

/** How many most-recent documents of the client to look at for a pattern. */
const LOOKBACK = 6;
/** Documents needed with the same signature before we call it recurring. */
const MIN_OCCURRENCES = 2;

/**
 * Detect the client's recurring document (same subject + item descriptions
 * on at least two of their last few documents) and propose it, rolled
 * forward to `newDate`. Prefers documents of the same type as the one being
 * created; falls back to any non-credit-note type. Returns null when nothing
 * recurring is found.
 */
export function getRecurringPrefill(
  clientDocs: InvoiceDocument[],
  documentType: DocumentType,
  newDate: string
): RecurringPrefill | null {
  if (documentType === "credit_note") return null;
  const usable = clientDocs
    .filter((d) => d.status !== "cancelled" && d.status !== "draft" && d.type !== "credit_note")
    .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  if (usable.length < MIN_OCCURRENCES) return null;

  const sameType = usable.filter((d) => d.type === documentType);
  const pool = (sameType.length >= MIN_OCCURRENCES ? sameType : usable).slice(0, LOOKBACK);

  // Group by signature, most-recent-first order preserved inside each group.
  const groups = new Map<string, InvoiceDocument[]>();
  for (const d of pool) {
    const sig = documentSignature(d);
    if (!sig) continue;
    const g = groups.get(sig);
    if (g) g.push(d);
    else groups.set(sig, [d]);
  }

  let best: InvoiceDocument[] | null = null;
  for (const g of groups.values()) {
    if (g.length < MIN_OCCURRENCES) continue;
    // Most occurrences wins; on a tie, the group whose latest doc is newer.
    if (!best || g.length > best.length || (g.length === best.length && g[0].date > best[0].date)) {
      best = g;
    }
  }
  if (!best) return null;

  const src = best[0];
  return {
    subject: rollTextForward(src.subject?.trim() || "", src.date, newDate),
    items: (src.items || []).map((i) => ({
      description: rollTextForward(i.description || "", src.date, newDate),
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    source: { id: src.id, number: src.number, date: src.date, type: src.type },
    occurrences: best.length,
  };
}

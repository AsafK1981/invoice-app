// Parses the free-text corrections a user sends after tapping "ערוך" on a
// WhatsApp expense card ("סכום 120", "תאריך 26/07/2026", "ספק כנען סנטר",
// ...). Deterministic on purpose: this runs on every text message while an
// expense is in edit mode, so it must be free, instant and predictable, and a
// misread here would put a wrong number in the user's books just as surely as
// a misread of the receipt. Anything it does not understand is reported back
// as such, never guessed.

import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/expense-scan";

export interface ExpenseEditPatch {
  vendor?: string;
  amount?: number;
  vatAmount?: number | null;
  date?: string;
  category?: ExpenseCategory;
  description?: string;
}

export interface ExpenseEditResult {
  patch: ExpenseEditPatch;
  /** Lines we could not interpret, verbatim, so the reply can quote them. */
  unrecognized: string[];
}

const KEYS = {
  vendor: /^(?:ספק|שם(?:\s+ספק)?|עסק|חנות|vendor|supplier)\s*[:\-]?\s*(.+)$/i,
  amount: /^(?:סכום|סה"?כ|סה״כ|מחיר|amount|total)\s*[:\-]?\s*(.+)$/i,
  vat: /^(?:מע"מ|מע״מ|מעמ|vat)\s*[:\-]?\s*(.+)$/i,
  date: /^(?:תאריך|date)\s*[:\-]?\s*(.+)$/i,
  category: /^(?:קטגוריה|category)\s*[:\-]?\s*(.+)$/i,
  description: /^(?:תיאור|פירוט|הערה|description)\s*[:\-]?\s*(.+)$/i,
};

/**
 * @param text   the whole message body
 * @param today  YYYY-MM-DD in Israel, used to complete a "26/7" style date
 */
export function parseExpenseEdit(text: string, today: string): ExpenseEditResult {
  const patch: ExpenseEditPatch = {};
  const unrecognized: string[] = [];

  const lines = text
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    let m: RegExpMatchArray | null;

    if ((m = line.match(KEYS.vendor))) {
      const v = m[1].trim();
      if (v) patch.vendor = v.slice(0, 120);
      else unrecognized.push(line);
      continue;
    }
    if ((m = line.match(KEYS.amount))) {
      const n = parseMoney(m[1]);
      if (n != null && n > 0) patch.amount = n;
      else unrecognized.push(line);
      continue;
    }
    if ((m = line.match(KEYS.vat))) {
      const raw = m[1].trim();
      if (/^(0|אין|ללא|בלי|none)$/i.test(raw)) {
        patch.vatAmount = null;
        continue;
      }
      const n = parseMoney(raw);
      if (n != null && n >= 0) patch.vatAmount = n === 0 ? null : n;
      else unrecognized.push(line);
      continue;
    }
    if ((m = line.match(KEYS.date))) {
      const d = parseIsraeliDate(m[1], today);
      if (d) patch.date = d;
      else unrecognized.push(line);
      continue;
    }
    if ((m = line.match(KEYS.category))) {
      const c = matchCategory(m[1]);
      if (c) patch.category = c;
      else unrecognized.push(line);
      continue;
    }
    if ((m = line.match(KEYS.description))) {
      const v = m[1].trim();
      if (v) patch.description = v.slice(0, 200);
      else unrecognized.push(line);
      continue;
    }

    // Keyword-less shortcuts: a bare number is the amount, a bare date is the
    // date, a bare category name is the category. Anything else is unknown -
    // we do NOT assume a bare word is the vendor, that is how typos become
    // supplier names.
    const bareDate = parseIsraeliDate(line, today);
    if (bareDate) {
      patch.date = bareDate;
      continue;
    }
    const bareCat = matchCategory(line);
    if (bareCat) {
      patch.category = bareCat;
      continue;
    }
    const bareNum = /^[\d.,]+\s*(?:₪|ש"ח|ש״ח|שח|nis|ils)?$/i.test(line) ? parseMoney(line) : null;
    if (bareNum != null && bareNum > 0) {
      patch.amount = bareNum;
      continue;
    }
    unrecognized.push(line);
  }

  return { patch, unrecognized };
}

function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[₪\s]|ש"ח|ש״ח|שח|nis|ils/gi, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n > 10_000_000) return null;
  return Math.round(n * 100) / 100;
}

/** DD/MM/YYYY, DD.MM.YY, DD-MM, or YYYY-MM-DD → YYYY-MM-DD, or null. */
export function parseIsraeliDate(raw: string, today: string): string | null {
  const s = raw.trim();
  let y: number, mo: number, d: number;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/))) {
    d = +m[1]; mo = +m[2];
    const ty = +today.slice(0, 4);
    if (m[3] == null) y = ty;
    else y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    // "26/7" with no year: if that lands in the future, they meant last year.
    if (m[3] == null && iso(y, mo, d) > today) y = ty - 1;
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const out = iso(y, mo, d);
  // Tomorrow at most (timezone slack); receipts are not from the future.
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 1);
  if (dt.getTime() > limit.getTime()) return null;
  return out;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function matchCategory(raw: string): ExpenseCategory | null {
  const s = raw.trim().replace(/["״׳']/g, "");
  const hit = (EXPENSE_CATEGORIES as readonly string[]).find((c) => c === s);
  return (hit as ExpenseCategory | undefined) ?? null;
}

/** The instruction text sent when the user taps ערוך. */
export const EDIT_INSTRUCTIONS = [
  "מה לשנות? שלח שורה לכל שדה, למשל:",
  "סכום 120",
  "ספק כנען סנטר",
  "תאריך 26/07/2026",
  "מע״מ 18.3 (או: מע״מ אין)",
  `קטגוריה ${EXPENSE_CATEGORIES.slice(0, -1).join(" / ")}`,
  "תיאור לוח גבס",
  "",
  "אפשר כמה שורות בהודעה אחת. או ״בטל״.",
].join("\n");

import type { DocumentType } from "@/lib/types";

/**
 * Normalize a raw "document type" cell before matching: lowercase, collapse
 * slashes / hyphens / whitespace to single spaces. This lets a single set of
 * substring rules cover every vendor's punctuation variant, e.g.
 *   "חשבונית מס/קבלה" = "חשבונית מס-קבלה" = "חשבונית מס  קבלה"
 * all normalize to "חשבונית מס קבלה". Underscores are preserved so our own
 * enum keys ("tax_invoice_receipt") still match exactly.
 */
function normalizeTypeInput(raw: string): string {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Exact-code lookup: iCount English keys, our own enum keys, and the numeric
 * מבנה-אחיד / BKMVDATA document-type codes. Matched before the fuzzy substring
 * rules because e.g. iCount "invrec" or the code "320" must not fall through to
 * the looser Hebrew/English matching.
 */
const EXACT_TYPE_CODES: Record<string, DocumentType> = {
  // our own enum keys
  tax_invoice_receipt: "tax_invoice_receipt",
  credit_note: "credit_note",
  proforma: "proforma",
  quote: "quote",
  tax_invoice: "tax_invoice",
  receipt: "receipt",
  // iCount English codes
  invrec: "tax_invoice_receipt",
  invoice: "tax_invoice",
  deal: "proforma",
  refund: "credit_note",
  offer: "quote",
  // numeric מבנה-אחיד / BKMVDATA codes
  "320": "tax_invoice_receipt",
  "305": "tax_invoice",
  "330": "credit_note",
  "400": "receipt",
  "405": "receipt",
  "300": "proforma",
  "10": "quote",
};

/**
 * Canonical mapping from a raw CSV/xlsx "document type" cell to our internal
 * DocumentType, together with whether anything actually matched.
 *
 * This is the single source of truth: csv-import-modal, bulk-import-zone and
 * the admin import route all call it, so the three flows can never drift.
 *
 * `matched` is false when the cell was empty or nothing recognized it. Import
 * paths use this to COUNT unrecognized rows ("סוג מסמך לא זוהה") instead of
 * silently storing them as receipts. They still import as receipt (to avoid
 * data loss) but flag the count so the user can review.
 *
 * Order matters: most-specific label first, so e.g. "חשבונית מס/קבלה" is
 * matched before the looser "חשבונית"/"קבלה" fallbacks. A standalone "חשבון"
 * (without "קבלה") maps to tax_invoice; an עוסק מורשה export uses it for the
 * tax invoice.
 */
export function resolveDocumentTypeStrict(raw: string): { type: DocumentType; matched: boolean } {
  const t = normalizeTypeInput(raw);
  if (!t) return { type: "receipt", matched: false };

  // Exact code / enum-key match first.
  if (Object.prototype.hasOwnProperty.call(EXACT_TYPE_CODES, t)) {
    return { type: EXACT_TYPE_CODES[t], matched: true };
  }

  // חשבונית מס/קבלה: the combined tax-invoice-receipt
  if (
    t.includes("חשבונית מס קבלה") ||
    (t.includes("חשבונית") && t.includes("מס") && t.includes("קבלה")) ||
    t.includes("tax invoice receipt") ||
    (t.includes("tax") && t.includes("invoice") && t.includes("receipt"))
  ) {
    return { type: "tax_invoice_receipt", matched: true };
  }
  // חשבונית זיכוי: credit note
  if (t.includes("זיכוי") || t.includes("credit")) return { type: "credit_note", matched: true };
  // חשבון עסקה / חשבונית עסקה: proforma / transaction account
  if (
    t.includes("חשבון עסקה") ||
    t.includes("חשבון עיסקה") ||
    t.includes("חשבונית עסקה") ||
    t.includes("עסקה") ||
    t.includes("עיסקה") ||
    t.includes("proforma") ||
    t.includes("pro forma") ||
    t.includes("transaction")
  ) {
    return { type: "proforma", matched: true };
  }
  // הצעת מחיר: quote / price quote / estimate
  if (
    t.includes("הצעת מחיר") ||
    t.includes("הצעה") ||
    t.includes("price quote") ||
    t.includes("quote") ||
    t.includes("estimate")
  ) {
    return { type: "quote", matched: true };
  }
  // חשבונית מס / חשבונית / standalone חשבון (without קבלה): tax invoice
  if (
    t.includes("חשבונית מס") ||
    t.includes("חשבונית") ||
    (t.includes("חשבון") && !t.includes("קבלה")) ||
    t.includes("tax invoice") ||
    t.includes("invoice")
  ) {
    return { type: "tax_invoice", matched: true };
  }
  // קבלה: receipt
  if (t.includes("קבלה") || t.includes("receipt")) return { type: "receipt", matched: true };

  // Unknown: caller should flag as "סוג לא מזוהה". We still default to receipt
  // so a mis-typed row is imported rather than dropped.
  return { type: "receipt", matched: false };
}

/**
 * Build a validated `YYYY-MM-DD` string, or null if the numbers aren't a real
 * calendar date. `new Date(year, month, 0)` gives the last day of the 1-indexed
 * month, so day-of-month is bounds-checked including February / leap years.
 */
function buildISODate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Convert an Excel serial date number (days since the 1899-12-30 epoch that
 * Excel/Sheets use) to an ISO `YYYY-MM-DD` string. Computed in UTC so the local
 * timezone never shifts the day.
 */
export function excelSerialToISO(n: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/**
 * Normalize a raw date cell to `YYYY-MM-DD`, or return null if it can't be
 * parsed as a real calendar date.
 *
 * Israeli sources (Invoice4U / Morning / iCount etc.) export DD/MM/YYYY. Passing
 * that straight to Postgres casts it with the server default DateStyle 'MDY',
 * which SWAPS day/month (05/06/2025 → 6 May) or REJECTS the row when day > 12
 * (30/11/2025 → month 30 → error). We parse day-first here and hand Postgres an
 * unambiguous ISO date.
 *
 * AMBIGUITY RULE: for slash/dot/dash separated all-numeric dates the leading
 * component decides; a 4-digit leading component is treated as year-first
 * (YYYY/MM/DD), otherwise day-first (Israeli DD/MM/YYYY). We never guess
 * month-first.
 *
 * Also handles: ISO date & datetime, YYYYMMDD (BKMVDATA), "DD/MM/YYYY HH:MM(:SS)"
 * datetime, and Excel serial numbers.
 */
export function normalizeImportDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const original = String(raw).trim();
  if (!original) return null;

  // Already an ISO date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(original)) return original;
  // ISO datetime: keep the date part.
  if (/^\d{4}-\d{2}-\d{2}T/.test(original)) return original.slice(0, 10);

  // Pure digits: either YYYYMMDD (BKMVDATA) or an Excel serial number.
  if (/^\d+$/.test(original)) {
    if (original.length === 8) {
      const iso = buildISODate(
        parseInt(original.slice(0, 4), 10),
        parseInt(original.slice(4, 6), 10),
        parseInt(original.slice(6, 8), 10),
      );
      if (iso) return iso;
    }
    const n = parseInt(original, 10);
    // Excel/Sheets serial range ≈ 1954-08-14 .. 2064-03-22.
    if (n >= 20000 && n <= 60000) return excelSerialToISO(n);
    return null;
  }

  // Strip a trailing clock time so "05/06/2025 14:30(:00)" parses as a date.
  const s = original.replace(/[ ]+\d{1,2}:\d{2}(:\d{2})?$/, "").trim();

  // Year-first: YYYY/MM/DD or YYYY.MM.DD (4-digit leading component).
  const ym = s.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
  if (ym) {
    return buildISODate(parseInt(ym[1], 10), parseInt(ym[2], 10), parseInt(ym[3], 10));
  }

  // Day-first DD/MM/YYYY with / . or - separators; 2- or 4-digit year.
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) {
    let year = parseInt(m[3], 10);
    if (m[3].length === 2) year += 2000;
    return buildISODate(year, parseInt(m[2], 10), parseInt(m[1], 10));
  }

  return null;
}

/**
 * Import-time date resolution used by every import path.
 *
 * - empty/missing  → `fallback` (today): the row had no date column
 * - present + valid → normalized `YYYY-MM-DD`
 * - present + invalid → `null`: caller should skip and count the row
 */
export function resolveImportDate(raw: string | null | undefined, fallback: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return fallback;
  return normalizeImportDate(trimmed);
}

/**
 * Parse a raw amount cell to a number, or null if it isn't a number.
 *
 * Handles the real-world mess vendors emit:
 * - currency symbols / ISO codes: ₪ $ € "ILS" "USD" "EUR" "NIS"
 * - thousands separators: "1,234.56" → 1234.56
 * - EU decimal format: "1.234,56" → 1234.56 (dot=thousands, comma=decimal)
 * - accounting negatives: "(100)" → -100 (needed for credit notes)
 * - leading sign: "-50" → -50
 *
 * Returns null when the remaining string isn't finite, so callers can skip and
 * count the row rather than inserting NaN.
 */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  let s = raw.trim();
  if (!s) return null;

  let sign = 1;
  // Accounting parentheses → negative.
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }

  // Strip currency symbols / ISO codes / all whitespace.
  s = s
    .replace(/[₪$€]/g, "")
    .replace(/ILS|USD|EUR|NIS/gi, "")
    .replace(/\s/g, "")
    .trim();

  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!s) return null;

  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) {
    // EU format: dot=thousands, comma=decimal.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",") && !s.includes(".")) {
    // Comma but no dot: thousands grouping ("1,234") vs decimal comma ("1234,5").
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
  } else {
    // Standard: strip thousands commas, dot is the decimal point.
    s = s.replace(/,/g, "");
  }

  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return sign * n;
}

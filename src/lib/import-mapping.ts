import type { DocumentType } from "@/lib/types";

/**
 * Canonical mapping from a raw CSV/xlsx "document type" cell (Hebrew labels
 * seen in Invoice4U / Morning / Greeninvoice / iCount exports, plus our own
 * English enum keys) to our internal DocumentType.
 *
 * This is the single source of truth — csv-import-modal, bulk-import-zone and
 * the admin import route all call it, so the three flows can never drift.
 *
 * Order matters: most-specific label first, so e.g. "חשבונית מס/קבלה" is
 * matched before the looser "חשבונית"/"קבלה" fallbacks. A standalone "חשבון"
 * (without "קבלה") maps to tax_invoice — Invoice4U exports from an עוסק מורשה
 * account use it for the tax invoice.
 */
export function resolveDocumentType(raw: string): DocumentType {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return "receipt";

  // חשבונית מס/קבלה — the combined tax-invoice-receipt
  if (
    t === "tax_invoice_receipt" ||
    t.includes("חשבונית מס/קבלה") ||
    t.includes("חשבונית מס קבלה") ||
    (t.includes("חשבונית") && t.includes("מס") && t.includes("קבלה"))
  ) {
    return "tax_invoice_receipt";
  }
  // חשבונית זיכוי — credit note
  if (t === "credit_note" || t.includes("זיכוי")) return "credit_note";
  // חשבון עסקה — proforma / transaction account
  if (
    t === "proforma" ||
    t.includes("חשבון עסקה") ||
    t.includes("חשבון עיסקה") ||
    t.includes("עסקה")
  ) {
    return "proforma";
  }
  // הצעת מחיר — quote
  if (t === "quote" || t.includes("הצעת מחיר") || t.includes("הצעה")) return "quote";
  // חשבונית מס / חשבונית / standalone חשבון (without קבלה) — tax invoice
  if (
    t === "tax_invoice" ||
    t === "invoice" ||
    t.includes("חשבונית") ||
    (t.includes("חשבון") && !t.includes("קבלה"))
  ) {
    return "tax_invoice";
  }
  // קבלה — receipt
  if (t === "receipt" || t.includes("קבלה")) return "receipt";

  // Unknown — historical imports skew to receipt.
  return "receipt";
}

/**
 * Normalize a raw date cell to `YYYY-MM-DD`, or return null if it can't be
 * parsed as a real calendar date.
 *
 * Israeli sources (Invoice4U etc.) export DD/MM/YYYY. Passing that string
 * straight to Postgres casts it with the server default DateStyle 'MDY',
 * which SWAPS day/month (e.g. 05/06/2025 → 6 May) or REJECTS the row when
 * day > 12 (e.g. 30/11/2025 → month 30 → error). We therefore parse
 * day-first here and hand Postgres an unambiguous ISO date.
 */
export function normalizeImportDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Already an ISO date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO datetime — keep the date part.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);

  // Day-first DD/MM/YYYY with / . or - separators; 2- or 4-digit year.
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (m[3].length === 2) year += 2000;
    if (month < 1 || month > 12) return null;
    // new Date(year, month, 0) → last day of the 1-indexed `month`.
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day < 1 || day > daysInMonth) return null;
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  return null;
}

/**
 * Import-time date resolution used by every import path.
 *
 * - empty/missing  → `fallback` (today) — the row had no date column
 * - present + valid → normalized `YYYY-MM-DD`
 * - present + invalid → `null` — caller should skip and count the row
 */
export function resolveImportDate(raw: string | null | undefined, fallback: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return fallback;
  return normalizeImportDate(trimmed);
}

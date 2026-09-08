import { DOCUMENT_TYPE_LABELS, type DocumentType, type InvoiceDocument } from "./types";

/**
 * בדיקת רצף מספור - the numbering-continuity check behind /reports/sequence.
 *
 * נספח ה' (א)(5) requires the software itself to report on the continuity of
 * the running number, and מחלקת ביקורת ממוחשבת spelled out that a sorted list
 * of what EXISTS does not satisfy it: "רשימה זו אינה עונה על הדרישה... התוצאה
 * הרצויה היא ציון מפורש של החשבוניות שקיימות או החשבוניות החסרות". So the
 * output here is the missing numbers themselves, enumerated.
 *
 * Every document type keeps its own counter (document_counters, one row per
 * business + type), so each type is a separate sequence.
 *
 * The counter does NOT reset on 1 January: a tax year is a window onto one
 * continuous sequence. A gap is therefore looked for in two places:
 *   * inside the year, between its first and its last number;
 *   * across the year boundary, between the last number issued in any earlier
 *     year and the first number of this one - a gap a within-year scan cannot
 *     see, because those numbers fall outside its own range.
 */
export type SequenceRow = {
  type: DocumentType;
  first: number;
  last: number;
  count: number;
  /** Enumerated, not counted: this list IS what the הנחיה asks for. */
  missing: number[];
  /** Last number of this type issued BEFORE the year, null when there is none. */
  previousYearLast: number | null;
};

function documentYear(doc: InvoiceDocument): number {
  return Number(String(doc.date ?? "").slice(0, 4));
}

/** One type's row, or null when the business issued none of it that year. */
export function buildSequenceRow(
  documents: InvoiceDocument[],
  type: DocumentType,
  year: number,
): SequenceRow | null {
  const inYear: number[] = [];
  let previousYearLast: number | null = null;

  for (const doc of documents) {
    if (doc.type !== type) continue;
    if (typeof doc.number !== "number" || !Number.isFinite(doc.number)) continue;
    const docYear = documentYear(doc);
    if (docYear === year) {
      inYear.push(doc.number);
    } else if (docYear < year && (previousYearLast === null || doc.number > previousYearLast)) {
      previousYearLast = doc.number;
    }
  }

  if (inYear.length === 0) return null;

  const present = new Set(inYear);
  const first = Math.min(...inYear);
  const last = Math.max(...inYear);
  const missing: number[] = [];

  if (previousYearLast !== null && first > previousYearLast + 1) {
    for (let n = previousYearLast + 1; n < first; n++) missing.push(n);
  }
  for (let n = first; n <= last; n++) {
    if (!present.has(n)) missing.push(n);
  }

  return { type, first, last, count: inYear.length, missing, previousYearLast };
}

/** Every document type that carries a running number, in the app's own order. */
export function buildSequenceRows(documents: InvoiceDocument[], year: number): SequenceRow[] {
  const rows: SequenceRow[] = [];
  for (const type of Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]) {
    const row = buildSequenceRow(documents, type, year);
    if (row) rows.push(row);
  }
  return rows;
}

/** Total across every type, i.e. the report's one-line verdict. */
export function totalMissing(rows: SequenceRow[]): number {
  return rows.reduce((sum, row) => sum + row.missing.length, 0);
}

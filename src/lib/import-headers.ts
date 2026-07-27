/**
 * Shared header-normalization + canonical field-alias layer for CSV/xlsx
 * imports. csv-import-modal, bulk-import-zone and the admin import route all
 * resolve columns through here so a Morning / iCount / Rivhit / Hashavshevet /
 * generic-Excel export lands on the same internal fields as an Invoice4U one.
 */

export type CanonicalField =
  | "number"
  | "type"
  | "client"
  | "date"
  | "total"
  | "vat"
  | "status"
  | "description";

export const CANONICAL_FIELDS: CanonicalField[] = [
  "number",
  "type",
  "client",
  "date",
  "total",
  "vat",
  "status",
  "description",
];

/**
 * Normalize a header cell for matching:
 * - trim, strip surrounding quotes, strip a trailing colon
 * - normalize slash / backslash / hyphen / underscore separators to spaces
 * - collapse whitespace, lowercase
 *
 * Internal gershayim (e.g. סה"כ, מע"מ) are preserved; only quotes wrapping the
 * whole cell are stripped.
 */
export function normalizeHeader(h: string): string {
  let s = String(h ?? "").trim();
  s = s.replace(/:+\s*$/, "");
  s = s.replace(/^["'`]+/, "").replace(/["'`]+$/, "");
  s = s.replace(/[/\\_-]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.toLowerCase();
}

/**
 * Canonical field → accepted source-header aliases (Hebrew synonyms across
 * vendors + English). Aliases are matched after normalizeHeader, so punctuation
 * variants don't need to be listed separately.
 */
const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  number: [
    "מספר מסמך",
    "מספר",
    "ספרור",
    "מס' מסמך",
    "מספר אסמכתא",
    "מס מסמך",
    "אסמכתא",
    "number",
    "doc number",
    "document number",
    "invoice number",
  ],
  type: ["סוג מסמך", "סוג", "type", "document type", "doc type", "doctype"],
  client: [
    "שם לקוח",
    "לקוח",
    "שם חשבון",
    "שם הלקוח",
    "client",
    "client name",
    "customer",
    "customer name",
    "name",
  ],
  date: [
    "תאריך",
    "תאריך הפקה",
    "תאריך מסמך",
    "תאריך המסמך",
    "תאריך אסמכתא",
    "תאריך ערך",
    "date",
    "issue date",
    "document date",
  ],
  total: [
    'סה"כ',
    "סהכ",
    'סה"כ כולל מע"מ',
    "סכום כולל",
    "סכום",
    'סה"כ המסמך',
    'סה"כ לתשלום',
    "לתשלום",
    "total",
    "amount",
    "grand total",
    "total incl vat",
  ],
  vat: ['מע"מ', "מעמ", 'אחוז מע"מ', 'סכום מע"מ', "vat", "tax"],
  status: ["סטטוס", "status", "מצב", "paid"],
  description: ["תיאור", "נושא", "פרטים", "subject", "description", "details"],
};

// Precompute normalized-alias → canonical-field. First alias wins on collision.
const NORMALIZED_ALIAS_TO_FIELD = new Map<string, CanonicalField>();
// Per-field normalized aliases, longest-first, for the substring fallback.
const NORMALIZED_ALIASES_BY_FIELD = {} as Record<CanonicalField, string[]>;
for (const field of CANONICAL_FIELDS) {
  const normalized = new Set<string>();
  for (const alias of FIELD_ALIASES[field]) {
    const n = normalizeHeader(alias);
    normalized.add(n);
    if (!NORMALIZED_ALIAS_TO_FIELD.has(n)) NORMALIZED_ALIAS_TO_FIELD.set(n, field);
  }
  // Match longer aliases first so "סה\"כ כולל מע\"מ" wins over "סה\"כ".
  NORMALIZED_ALIASES_BY_FIELD[field] = Array.from(normalized).sort((a, b) => b.length - a.length);
}

/**
 * Map a sheet's headers to canonical fields. Returns, per canonical field, the
 * ORIGINAL source-header string that maps to it (so it can index the row), or
 * null when no column matched.
 *
 * Two passes: (1) normalized-exact: a header whose normalized form equals an
 * alias, first header wins; then (2) substring fallback: for fields still
 * unmatched, a header that CONTAINS an alias (e.g. "מספר מסמך פנימי" → number).
 * A header claimed in an earlier pass/field is never reused, so a specific
 * column like "סכום מע\"מ" (claimed by vat) can't be stolen by total's looser
 * "סכום" substring. Exact always beats substring.
 */
export function mapHeaders(headers: string[]): Record<CanonicalField, string | null> {
  // One source for the field list: derive the all-null map from CANONICAL_FIELDS.
  const out = Object.fromEntries(
    CANONICAL_FIELDS.map((f) => [f, null]),
  ) as Record<CanonicalField, string | null>;
  const claimed = new Set<string>();

  // Pass 1: normalized-exact.
  for (const h of headers) {
    if (claimed.has(h)) continue;
    const field = NORMALIZED_ALIAS_TO_FIELD.get(normalizeHeader(h));
    if (field && out[field] === null) {
      out[field] = h;
      claimed.add(h);
    }
  }

  // Pass 2: substring fallback for fields no exact header claimed.
  for (const field of CANONICAL_FIELDS) {
    if (out[field] !== null) continue;
    const aliases = NORMALIZED_ALIASES_BY_FIELD[field];
    for (const h of headers) {
      if (claimed.has(h)) continue;
      const nh = normalizeHeader(h);
      if (aliases.some((a) => a.length >= 2 && nh.includes(a))) {
        out[field] = h;
        claimed.add(h);
        break;
      }
    }
  }

  return out;
}

/**
 * Read a canonical field's value from a row using a precomputed headers map.
 * Returns the trimmed string, or "" when the column is absent/empty.
 */
export function pickField(
  row: Record<string, unknown>,
  headersMap: Record<CanonicalField, string | null>,
  field: CanonicalField,
): string {
  const src = headersMap[field];
  if (!src) return "";
  const v = row[src];
  if (v == null) return "";
  return typeof v === "string" ? v.trim() : String(v).trim();
}

/**
 * A sheet is "documents" when it has a number + a client + a total column.
 * Shared by every entity-detection path.
 */
export function isDocumentsHeaderSet(headers: string[]): boolean {
  const m = mapHeaders(headers);
  return !!(m.number && m.client && m.total);
}

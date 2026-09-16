/**
 * One imported clients-file row -> a new Client. Shared by the clients CSV
 * modal and the bulk import zone, so both read the same columns the same way.
 *
 * Pure: the id and the date are passed in.
 */

import { hebrewCount } from "./format";
import { parsePaymentTerms } from "./payment-terms";
import type { Client } from "./types";

type Row = Record<string, string | undefined>;

/** Header spellings of the optional תנאי תשלום column (compared trimmed, case-insensitive). */
export const PAYMENT_TERMS_HEADER_ALIASES = [
  "תנאי תשלום",
  "תנאי_תשלום",
  "payment_terms",
  "payment terms",
  "terms",
];

const TERMS_HEADERS = new Set(PAYMENT_TERMS_HEADER_ALIASES);

function normalizeHeader(header: string): string {
  return header.replace(/\s+/g, " ").trim().toLowerCase();
}

function pick(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** The first non-empty value under any תנאי תשלום header, "" when there is none. */
export function paymentTermsCell(row: Row): string {
  for (const [header, value] of Object.entries(row)) {
    if (!TERMS_HEADERS.has(normalizeHeader(header))) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export interface ImportedClient {
  client: Client;
  /** The file stated terms, and they were not recognised, so none were set. */
  termsUnrecognized: boolean;
}

/** null when the row has no name (the importers skip it). */
export function mapImportedClientRow(
  row: Row,
  opts: { id: string; createdAt: string },
): ImportedClient | null {
  const name = pick(row, "שם", "name");
  if (!name) return null;
  const termsText = paymentTermsCell(row);
  const paymentTerms = parsePaymentTerms(termsText);
  return {
    client: {
      id: opts.id,
      name,
      taxId: pick(row, "ח.פ / ת.ז", "ח.פ", "ת.ז", "tax_id") || undefined,
      address: pick(row, "כתובת", "address") || undefined,
      phone: pick(row, "טלפון", "phone") || undefined,
      email: pick(row, "אימייל", "email") || undefined,
      notes: pick(row, "הערות", "notes") || undefined,
      createdAt: opts.createdAt,
      paymentTerms,
    },
    termsUnrecognized: termsText !== "" && paymentTerms === undefined,
  };
}

/** The import summary line for clients whose terms text was not recognised; null for none. */
export function unrecognizedTermsNote(count: number): string | null {
  if (count <= 0) return null;
  const verb = count === 1 ? "יובא" : "יובאו";
  return `${hebrewCount(count, "לקוח אחד", "לקוחות")} ${verb} בלי תנאי תשלום, כי הערך בקובץ לא זוהה.`;
}

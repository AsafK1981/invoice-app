// Reader for OPENFORMAT 1.31 / מבנה אחיד exports produced by OTHER software.
//
// Every Israeli invoicing tool must be able to emit this file for the Tax
// Authority, and for most of them (EZcount, SUMIT, YPAY, MyBooks, ...) it is
// the ONLY complete export of document history: the "ייצוא לאקסל" buttons
// cover clients and single reports, not every document ever issued. So a
// switcher's most valuable file is a ZIP holding BKMVDATA.TXT + INI.TXT, and
// the bulk importer has to read it directly.
//
// Field positions are the same ones ./records.ts WRITES (both sides follow
// horaot_131.pdf), so this module is the exact inverse of buildC100 /
// buildD110. Keep the two in step: a position changed there must change here.
//
// Output is deliberately a plain header+rows grid, one row per document, with
// the same Hebrew column names the CSV/xlsx path already understands (see
// FIELD_ALIASES in ../import-headers.ts), so nothing downstream of the drop
// zone knows or cares that the source was fixed-width text.
import JSZip from "jszip";

export interface UniformDocumentRow {
  /** Column names match FIELD_ALIASES in import-headers.ts. */
  [column: string]: string;
}

export interface UniformParseResult {
  headers: string[];
  rows: UniformDocumentRow[];
  /** How many C100 headers were read (before any filtering). */
  docCount: number;
  /** Cancelled documents are still returned (flagged in סטטוס); counted here for the summary. */
  cancelledCount: number;
}

export const UNIFORM_HEADERS = [
  "סוג מסמך",
  "מספר מסמך",
  "תאריך",
  "שם לקוח",
  "ח.פ / ת.ז",
  "טלפון",
  'סה"כ',
  'מע"מ',
  "סטטוס",
  "תיאור",
] as const;

/** Appendix 1 of the spec. Anything unlisted is passed through as the raw code. */
const TYPE_LABEL: Record<string, string> = {
  "10": "הצעת מחיר",
  "100": "חשבון עסקה",
  "300": "חשבון עסקה",
  "305": "חשבונית מס",
  "320": "חשבונית מס קבלה",
  "330": "חשבונית זיכוי",
  "400": "קבלה",
  "405": "קבלה",
};

/** Is this a file the uniform-structure reader should handle? (by name only) */
export function looksLikeUniformStructure(fileName: string): boolean {
  return /\.(zip|txt)$/i.test(fileName);
}

/**
 * Decode BKMVDATA bytes. The spec mandates a single-byte Hebrew code page
 * (Windows-1255 / ISO-8859-8, identical for the letters), but a few vendors
 * emit UTF-8. Try strict UTF-8 first: real 1255 Hebrew is almost never valid
 * UTF-8, so a successful strict decode means the file really is UTF-8.
 */
function decodeHebrewBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1255").decode(bytes);
  }
}

/** Inverse of encode.ts formatSignedAmount: "+00000000150050" with 2 decimals -> 1500.5 */
function readSigned(field: string, decimalDigits: number): number {
  const t = field.trim();
  if (!t) return 0;
  const sign = t.startsWith("-") ? -1 : 1;
  const digits = t.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  return (sign * Number(digits)) / Math.pow(10, decimalDigits);
}

/** YYYYMMDD -> DD/MM/YYYY (the CSV path's parseDate reads both; the slash form is what a person expects to see in the preview). */
function readDate(field: string): string {
  const d = field.trim();
  if (!/^\d{8}$/.test(d) || d === "00000000") return "";
  return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
}

const money = (n: number) => (Math.round(n * 100) / 100).toString();

interface Header {
  type: string;
  number: string;
  date: string;
  clientName: string;
  clientTaxId: string;
  phone: string;
  subtotal: number;
  vat: number;
  total: number;
  cancelled: boolean;
  items: string[];
}

/**
 * Parse the text of one BKMVDATA.TXT into document rows.
 * Lenient on purpose: short lines yield empty fields instead of throwing, and
 * unknown record types (B100, B110, M100, D120, ...) are skipped.
 */
export function parseBkmvdataText(text: string): UniformParseResult {
  const docs = new Map<string, Header>();
  // Output order = order of C100 headers in the file. A D110 that arrives
  // before its header creates a placeholder in `docs` but must NOT claim a
  // slot here, or the real header would be silently dropped.
  const order: string[] = [];
  const ordered = new Set<string>();
  const f = (line: string, from: number, to: number) => line.slice(from - 1, to);

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    const rec = line.slice(0, 4);
    if (rec === "C100") {
      // Field numbers 1203-1228, positions from buildC100 in ./records.ts.
      const type = f(line, 23, 25).trim();
      const number = f(line, 26, 45).trim();
      const key = `${type}:${number}`;
      const h: Header = {
        type,
        number,
        date: readDate(f(line, 46, 53)),
        clientName: f(line, 58, 107).trim(),
        clientTaxId: f(line, 253, 261).trim().replace(/^0+(?=\d)/, ""),
        phone: f(line, 238, 252).trim(),
        subtotal: readSigned(f(line, 318, 332), 2),
        vat: readSigned(f(line, 333, 347), 2),
        total: readSigned(f(line, 348, 362), 2),
        cancelled: f(line, 400, 400).trim() === "1",
        items: docs.get(key)?.items ?? [],
      };
      if (!ordered.has(key)) {
        ordered.add(key);
        order.push(key);
      }
      docs.set(key, h);
    } else if (rec === "D110") {
      // Fields 1253-1254 (link to header) and 1260 (description).
      const type = f(line, 23, 25).trim();
      const number = f(line, 26, 45).trim();
      const desc = f(line, 94, 123).trim();
      if (!desc) continue;
      const key = `${type}:${number}`;
      const existing = docs.get(key);
      if (existing) {
        existing.items.push(desc);
      } else {
        // D110 before its C100 (allowed by the spec ordering rules): park the
        // description on a placeholder that the C100 will adopt.
        docs.set(key, {
          type, number, date: "", clientName: "", clientTaxId: "", phone: "",
          subtotal: 0, vat: 0, total: 0, cancelled: false, items: [desc],
        });
      }
    }
  }

  const rows: UniformDocumentRow[] = [];
  let cancelledCount = 0;
  for (const key of order) {
    const h = docs.get(key)!;
    if (!h.number) continue;
    if (h.cancelled) cancelledCount++;
    // Dedupe repeated item descriptions (a 40-line invoice of the same service
    // reads as one subject), cap the length so the preview stays a table.
    const description = Array.from(new Set(h.items)).join(" | ").slice(0, 300);
    rows.push({
      "סוג מסמך": TYPE_LABEL[h.type] ?? h.type,
      "מספר מסמך": h.number,
      "תאריך": h.date,
      "שם לקוח": h.clientName,
      "ח.פ / ת.ז": h.clientTaxId,
      "טלפון": h.phone,
      'סה"כ': money(h.total),
      'מע"מ': money(h.vat),
      "סטטוס": h.cancelled ? "מבוטל" : "",
      "תיאור": description,
    });
  }
  return { headers: [...UNIFORM_HEADERS], rows, docCount: rows.length, cancelledCount };
}

/**
 * Read a dropped file: either the ZIP the vendor hands out (BKMVDATA.TXT +
 * INI.TXT inside, any folder depth) or a bare BKMVDATA.TXT the user already
 * extracted. Throws a Hebrew message when neither is found.
 */
export async function parseUniformStructureFile(file: File): Promise<UniformParseResult> {
  let bytes: ArrayBuffer;
  if (/\.zip$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = Object.values(zip.files).find(
      (e) => !e.dir && /(^|[\\/])bkmvdata\.txt$/i.test(e.name),
    );
    if (!entry) {
      throw new Error(`בקובץ ${file.name} לא נמצא BKMVDATA.TXT. זה לא קובץ מבנה אחיד של רשות המסים.`);
    }
    bytes = await entry.async("arraybuffer");
  } else {
    bytes = await file.arrayBuffer();
  }
  const text = decodeHebrewBytes(bytes);
  if (!/^(A100|C100|D110|B1[01]0|M100)/m.test(text)) {
    throw new Error(`${file.name} לא נראה כמו קובץ מבנה אחיד (אין בו רשומות A100/C100).`);
  }
  const result = parseBkmvdataText(text);
  if (result.docCount === 0) {
    throw new Error(`בקובץ ${file.name} אין רשומות מסמכים (C100). ייתכן שייצאת טווח תאריכים ריק.`);
  }
  return result;
}

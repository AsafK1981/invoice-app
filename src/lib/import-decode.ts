import Papa from "papaparse";

/**
 * Decode raw uploaded CSV bytes into a JS string with the correct encoding.
 *
 * The #1 real-world silent-corruption source for Israeli imports: Excel's
 * "Save as CSV" writes Windows-1255 (not UTF-8), so Hebrew arrives as mojibake
 * or U+FFFD replacement characters when read as UTF-8. We therefore:
 *   1. honor a UTF-8 / UTF-16 LE / UTF-16 BE byte-order mark, else
 *   2. try strict UTF-8 (fatal) and accept it only if it has no replacement
 *      characters, else
 *   3. fall back to Windows-1255.
 *
 * The xlsx (SheetJS) path handles its own encoding and should NOT go through
 * here; this is for the CSV read paths only.
 */
export function decodeFileBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);

  // UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  // UTF-16 LE BOM
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  // UTF-16 BE BOM
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }

  // No BOM: try strict UTF-8, accept only if clean.
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!utf8.includes("�")) return utf8;
  } catch {
    // invalid UTF-8; fall through to the Hebrew legacy codepage
  }

  // Fallback: Windows-1255 (Hebrew), Israeli Excel "Save as CSV".
  return new TextDecoder("windows-1255").decode(bytes);
}

/**
 * Read + parse a CSV File in one step: encoding-detect the bytes via
 * decodeFileBytes (so cp1255 Israeli exports don't mojibake), then Papa.parse
 * with header rows. The single reader for every in-app CSV upload path, so none
 * of them can regress the encoding handling.
 */
export async function parseCsvFile(
  file: File,
): Promise<{ rows: Record<string, string>[]; headers: string[] }> {
  const text = decodeFileBytes(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve({ rows: results.data, headers: results.meta.fields ?? [] });
      },
      error: (err: Error) => reject(err),
    });
  });
}

// Encoding helpers for Israeli Tax Authority "מבנה אחיד" / OPENFORMAT 1.31.
//
// Every record is a single fixed-width line terminated with CRLF, encoded
// in Windows-1255 (the Hebrew code page). Numeric fields are right-aligned
// with leading zeros; string fields are left-aligned and space-padded (or
// truncated if too long).
//
// We expose pure string helpers here — final Windows-1255 encoding happens
// in `toWindows1255()` once the entire file content is assembled.

import iconv from "iconv-lite";

/** Right-align number/string with leading zeros to a fixed width. */
export function padNum(value: number | string, width: number): string {
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) s = "0";
    else s = String(Math.trunc(value));
  } else {
    s = (value ?? "").toString().replace(/[^\d-]/g, "");
    if (s === "" || s === "-") s = "0";
  }
  // For negative numbers we keep the minus sign and pad after it
  if (s.startsWith("-")) {
    const rest = s.slice(1);
    return "-" + rest.padStart(width - 1, "0");
  }
  if (s.length > width) return s.slice(-width); // truncate from left (keep low digits)
  return s.padStart(width, "0");
}

/** Left-align string with trailing spaces; truncate if too long. */
export function padStr(value: string | undefined | null, width: number): string {
  const s = (value ?? "").toString();
  // Replace anything that would corrupt the fixed-width layout (CR/LF/TAB)
  const clean = s.replace(/[\r\n\t]/g, " ");
  if (clean.length > width) return clean.slice(0, width);
  return clean.padEnd(width, " ");
}

/** YYYYMMDD — 8 chars. Accepts ISO-8601 date strings or Date objects. */
export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return "00000000";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "00000000";
  const y = String(d.getFullYear()).padStart(4, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${dd}`;
}

/** HHMM — 4 chars. */
export function formatTime(date: Date | undefined | null): string {
  if (!date) return "0000";
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}${m}`;
}

/**
 * Amounts in מבנה אחיד are signed, with 2 decimal places encoded as part
 * of the integer (i.e., 123.45 → "12345" — multiply by 100 and round).
 * Negative values keep a leading minus sign. Padded to the field width.
 */
export function formatAmount(value: number, width: number): string {
  if (!Number.isFinite(value)) return padNum(0, width);
  const agorot = Math.round(value * 100);
  return padNum(agorot, width);
}

/**
 * Signed amount per spec format X9(integerDigits)v9(decimalDigits).
 *
 *   X    sign — '+' for positive (or zero), '-' for negative
 *   9(n) n integer digits with leading zeros
 *   v    implied decimal point (no character emitted)
 *   9(m) m decimal digits
 *
 * Total length = 1 (sign) + integerDigits + decimalDigits.
 *
 * Example: formatSignedAmount(1500.50, 12, 2) → "+00000000150050"
 *          formatSignedAmount(-100.25, 9, 2)  → "-00000010025"
 */
export function formatSignedAmount(value: number, integerDigits: number, decimalDigits: number): string {
  if (!Number.isFinite(value)) value = 0;
  const sign = value < 0 ? "-" : "+";
  const absValue = Math.abs(value);
  const multiplier = Math.pow(10, decimalDigits);
  const scaled = Math.round(absValue * multiplier);
  const total = integerDigits + decimalDigits;
  return sign + String(scaled).padStart(total, "0");
}

/** Build a CRLF-terminated record line by concatenating its fixed-width parts. */
export function buildLine(parts: string[]): string {
  return parts.join("") + "\r\n";
}

/**
 * Encode a fully-assembled file (one long string with CRLFs) into a
 * Windows-1255 Buffer ready to write to disk / send over HTTP.
 *
 * Characters outside the Windows-1255 set are replaced with "?" by
 * iconv-lite — acceptable for tax data which is Hebrew + ASCII only.
 */
export function toWindows1255(text: string): Buffer {
  return iconv.encode(text, "windows-1255");
}

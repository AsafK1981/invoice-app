// Encoding helpers for Israeli Tax Authority "מבנה אחיד" / OPENFORMAT 1.31.
//
// Every record is a single fixed-width line terminated with CRLF, encoded
// in Windows-1255 (the Hebrew code page). Numeric fields are right-aligned
// with leading zeros; string fields are left-aligned and space-padded (or
// truncated if too long).
//
// We expose pure string helpers here; final Windows-1255 encoding happens
// in `toWindows1255()` once the entire file content is assembled.

import iconv from "iconv-lite";
import { isoDateInIsrael, validPcnDate } from "../ita/pcn874";

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

/**
 * The Asia/Jerusalem calendar date and clock of an instant. The export may run
 * on a server in UTC or on a machine west of it; the file must carry Israeli
 * dates either way (an instant just after midnight in Israel is "yesterday" in UTC).
 */
export function israelClock(at: Date): { date: string; hh: string; mm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: isoDateInIsrael(at), hh: part("hour"), mm: part("minute") };
}

/**
 * YYYYMMDD, 8 chars. A stored YYYY-MM-DD date (a document or period date) is a
 * calendar date and is written as it is; an instant is written as its Israeli date.
 */
export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return "00000000";
  if (typeof date === "string") {
    const calendar = date.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) return validPcnDate(calendar) ? calendar.replace(/-/g, "") : "00000000";
    const parsed = new Date(date);
    return isNaN(parsed.getTime()) ? "00000000" : isoDateInIsrael(parsed).replace(/-/g, "");
  }
  if (isNaN(date.getTime())) return "00000000";
  return isoDateInIsrael(date).replace(/-/g, "");
}

/** HHMM, 4 chars, Israeli clock. */
export function formatTime(date: Date | undefined | null): string {
  if (!date || isNaN(date.getTime())) return "0000";
  const { hh, mm } = israelClock(date);
  return `${hh}${mm}`;
}

/**
 * Amounts in מבנה אחיד are signed, with 2 decimal places encoded as part
 * of the integer (i.e., 123.45 → "12345", multiply by 100 and round).
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
 *   X    sign: '+' for positive (or zero), '-' for negative
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
 * iconv-lite, acceptable for tax data which is Hebrew + ASCII only.
 */
export function toWindows1255(text: string): Buffer {
  return iconv.encode(text, "windows-1255");
}

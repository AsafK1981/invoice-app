/**
 * Israeli ID / business-number check-digit validator.
 *
 * The same algorithm validates ת.ז (private ID), ח.פ (company number) and
 * ע.מ (עוסק מורשה/פטור number) - all are 9-digit numbers with the same
 * Luhn-style check digit, so one function covers all three.
 *
 * Algorithm: pad to 9 digits with leading zeros, multiply each digit
 * (left to right) alternately by 1 and 2, and for any product greater
 * than 9 subtract 9 (equivalent to summing its own digits, since a
 * single digit times 2 never exceeds 18). The number is valid iff the
 * total of those adjusted products is divisible by 10.
 */

/**
 * Validate a 9-digit Israeli ID/business-number check digit.
 *
 * Accepts input with non-digit characters (spaces, hyphens) already
 * present, e.g. copy-pasted from a document; they are stripped before
 * validation. Shorter numeric input is left-padded with zeros to 9
 * digits, matching how the Tax Authority and Population Registry treat
 * IDs (a "12345678" ת.ז is really "012345678").
 *
 * @param value  raw input, any format; non-digit characters are stripped.
 * @returns true iff the 9-digit form passes the check-digit algorithm.
 *          Empty input, input with more than 9 digits, and the all-zero
 *          placeholder ("000000000") are always rejected.
 */
export function isValidIsraeliIdNumber(value: string): boolean {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return false;
  if (digits.length > 9) return false;
  if (/^0+$/.test(digits)) return false;

  const padded = digits.padStart(9, "0");
  let total = 0;
  for (let i = 0; i < 9; i++) {
    const digit = Number(padded[i]);
    // Left to right, odd positions (1st, 3rd, ...) multiply by 1, even
    // positions (2nd, 4th, ...) multiply by 2.
    const multiplier = i % 2 === 0 ? 1 : 2;
    let product = digit * multiplier;
    if (product > 9) product -= 9;
    total += product;
  }
  return total % 10 === 0;
}

export type BusinessNumberReason = "ok" | "empty" | "letters" | "too_long" | "checksum";

export interface NormalizedBusinessNumber {
  /** The 9-digit form, only when reason is "ok". */
  value: string | null;
  reason: BusinessNumberReason;
  /** Digits the raw value held before padding (Layer 1 uses it to tell "missing a leading zero" apart). */
  digitCount: number;
}

/**
 * Characters a pasted business number may legitimately carry around its
 * digits: whitespace, hyphens, dots, bidi controls (LRM/RLM, embeddings,
 * isolates) and zero-width marks. Anything else makes the value "letters".
 */
const ALLOWED_BUSINESS_NUMBER = /^[\d\s.\-​-‏‪-‮⁦-⁩﻿]*$/;

/**
 * The ONE decision about an Israeli business number, shared by the PCN874
 * builder, its preflight, the form hints and client matching. Strict on
 * purpose: letters are never stripped and extra digits are never truncated,
 * because a "repaired" wrong number in a filed report is worse than a
 * visible question.
 */
export function normalizeBusinessNumber(raw: unknown): NormalizedBusinessNumber {
  const text = String(raw ?? "");
  const digits = text.replace(/\D/g, "");
  if (!ALLOWED_BUSINESS_NUMBER.test(text)) return { value: null, reason: "letters", digitCount: digits.length };
  if (digits.length === 0) return { value: null, reason: "empty", digitCount: 0 };
  if (digits.length > 9) return { value: null, reason: "too_long", digitCount: digits.length };
  const padded = digits.padStart(9, "0");
  if (!isValidIsraeliIdNumber(padded)) return { value: null, reason: "checksum", digitCount: digits.length };
  return { value: padded, reason: "ok", digitCount: digits.length };
}

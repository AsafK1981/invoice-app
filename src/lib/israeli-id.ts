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

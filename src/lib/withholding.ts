import { round2 } from "@/lib/vat";

/**
 * ניכוי מס במקור (withholding tax) helpers.
 *
 * The customer withholds part of the payment and remits it to the Tax
 * Authority on the supplier's behalf. It is NOT a change to the document
 * total: the invoice still says "total X"; the split is
 * `X = actually-paid + withheld`.
 *
 * Israeli practice reports withholding in WHOLE shekels (the אישור ניכוי
 * במקור and the customer's 856 report are filed in whole shekels), so the
 * amount we SUGGEST is rounded to the nearest shekel. The user may still type
 * any amount they were actually paid; a manual entry is never rewritten.
 */

/**
 * The suggested withholding amount for a document total and a rate in percent,
 * rounded to the NEAREST WHOLE SHEKEL (0.5 rounds up).
 *
 * The intermediate product is passed through round2 first, so a value that is
 * mathematically x.5 but stored a hair below it (float) still rounds up.
 *
 * Returns 0 for a non-positive / non-finite rate or total, which the caller
 * treats as "no suggestion".
 */
export function suggestedWithholding(total: number, ratePercent: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(ratePercent)) return 0;
  if (total <= 0 || ratePercent <= 0) return 0;
  return Math.round(round2((total * ratePercent) / 100));
}

/**
 * What the supplier actually receives: the document total minus what the
 * customer withheld. Kept at 2 decimals so the reconciliation invariant
 * `total = netAfterWithholding + withholdingAmount` holds exactly, with no
 * float dust leaking into the printed document.
 */
export function netAfterWithholding(total: number, withholdingAmount: number): number {
  const withheld = Number.isFinite(withholdingAmount) ? withholdingAmount : 0;
  return round2(total - withheld);
}

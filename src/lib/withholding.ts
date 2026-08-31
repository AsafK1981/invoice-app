import { round2 } from "@/lib/vat";

/**
 * ניכוי מס במקור (withholding tax) helpers.
 *
 * The customer withholds part of the payment and remits it to the Tax
 * Authority on the supplier's behalf. It is NOT a change to the document
 * total: the invoice still says "total X"; the split is
 * `X = actually-paid + withheld`.
 *
 * The owner's rounding rule (2026-08-31) is HALF-UP everywhere: .5 and above
 * goes up, below .5 goes down. Applied to the SUGGESTED split in two steps:
 *
 * 1. The withholding is rounded to the nearest whole shekel (the אישור ניכוי
 *    במקור and the customer's 856 report are filed in whole shekels).
 * 2. "שולם בפועל" - the net the supplier actually receives - must never show
 *    agorot: 10,641.50 reads 10,642. When the total itself carries agorot the
 *    net is rounded half-up to a whole shekel and the withholding absorbs the
 *    leftover (16,371.50 = 10,642 + 5,729.50), so the printed figures still
 *    add up exactly.
 *
 * The user may still type any amount they were actually paid; a manual entry
 * is never rewritten.
 */

/**
 * The default rate percentage shown when the withholding panel is opened
 * fresh, before the user has typed anything. 35% is the standard rate for a
 * supplier with no אישור ניכוי מס במקור on file.
 */
export const DEFAULT_WITHHOLDING_RATE_PERCENT = "35";

/**
 * The rate string to show right after the withholding panel is expanded.
 *
 * Only fills in the default when the rate field is genuinely empty. Any
 * existing value - from a resumed draft, a duplicated/converted document, or
 * a value the user already typed - is returned unchanged, so opening the
 * panel never silently overwrites a rate that came from somewhere else.
 */
export function withholdingRateOnPanelOpen(currentRateInput: string): string {
  return currentRateInput.trim() === "" ? DEFAULT_WITHHOLDING_RATE_PERCENT : currentRateInput;
}

/**
 * The suggested withholding amount for a document total and a rate in percent.
 *
 * `rate% of total` is rounded half-up to a whole shekel; the net that leaves
 * (`total - that`) is rounded half-up to a whole shekel as well; the
 * suggestion is whatever remains of the total. On a whole-shekel total both
 * parts are whole (990 = 817 + 173); on a total with agorot the withholding
 * carries them (16,371.50 = 10,642 + 5,729.50). Either way
 * `total = netAfterWithholding + suggestion` holds to the agora and the net
 * never shows agorot.
 *
 * round2 on the intermediate values nudges float dust, so a value that is
 * mathematically x.5 but stored a hair below it still rounds up.
 *
 * Only when the whole-shekel withholding would be 0 (a rate below half a
 * shekel of the total) does the plain agora-precision product come back, so
 * a tiny document still gets a suggestion rather than nothing.
 *
 * Returns 0 for a non-positive / non-finite rate or total, which the caller
 * treats as "no suggestion".
 */
export function suggestedWithholding(total: number, ratePercent: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(ratePercent)) return 0;
  if (total <= 0 || ratePercent <= 0) return 0;
  const raw = round2((total * ratePercent) / 100);
  const wholeWithheld = Math.round(raw);
  const net = Math.round(round2(total - wholeWithheld));
  if (net <= 0 || net >= total) return raw;
  return round2(total - net);
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

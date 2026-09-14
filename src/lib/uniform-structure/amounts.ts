// Amounts as the מבנה אחיד file carries them. The leading currency is ILS
// (field 1032), so C100 1219-1224, D110 1265/1267, D120 1312 and B100 1368 are
// shekels (horaot_131_raw.txt 2109-2118, 2978-2997, 3708-3717). A shekel
// document passes through untouched, so files of shekel-only businesses stay
// byte-identical. A foreign-currency document uses the shekel snapshots stored
// at issue; anything the snapshots do not cover is converted with the stored
// rate and rounded to agorot. Missing snapshots stay NaN: the preflight blocks
// them, nothing here invents a number.
import type { InvoiceDocument } from "../types";

export const round2 = (value: number) => Math.round(value * 100) / 100;

export interface UniformAmounts {
  foreign: boolean;
  /** ISO 4217 code, "ILS" for a shekel document. */
  currency: string;
  rate: number;
  subtotal: number;
  vat: number;
  total: number;
  discount: number;
  withholding: number;
  /** The most a journal rounding line may post: the stored rounding in shekels (at least one agora for a foreign document). */
  roundingCap: number;
}

export function isForeignCurrency(doc: Pick<InvoiceDocument, "currency">): boolean {
  return Boolean(doc.currency) && doc.currency !== "ILS";
}

export function uniformAmounts(doc: InvoiceDocument): UniformAmounts {
  if (!isForeignCurrency(doc)) {
    return {
      foreign: false,
      currency: "ILS",
      rate: 1,
      subtotal: doc.subtotal,
      vat: doc.vat,
      total: doc.total,
      discount: doc.discountAmount ?? 0,
      withholding: doc.withholdingAmount ?? 0,
      roundingCap: Math.abs(doc.rounding ?? 0),
    };
  }
  const rate = doc.exchangeRate ?? NaN;
  const convert = (value: number | undefined) => (value ? round2(value * rate) : 0);
  return {
    foreign: true,
    currency: String(doc.currency),
    rate,
    subtotal: doc.subtotalIls ?? NaN,
    vat: doc.vatIls ?? NaN,
    total: doc.totalIls ?? NaN,
    discount: convert(doc.discountAmount),
    withholding: convert(doc.withholdingAmount),
    // The three snapshots are each rounded to agorot at issue, so their sum can
    // miss the total by one agora even without a stored rounding.
    roundingCap: Math.max(Math.abs(convert(doc.rounding)), 0.01),
  };
}

/**
 * A foreign-currency document's shekel snapshots must match its rate and add
 * up (net + VAT + converted rounding = total), each within one agora. Catches
 * native amounts stored as shekels. Shekel documents always pass here.
 */
export function foreignIlsConsistent(doc: InvoiceDocument): boolean {
  if (!isForeignCurrency(doc)) return true;
  const rate = doc.exchangeRate ?? NaN;
  const { subtotalIls, vatIls, totalIls } = doc;
  if (![rate, subtotalIls, vatIls, totalIls].every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  const within = (a: number, b: number) => Math.abs(round2(a - b)) <= 0.01;
  return within(totalIls!, round2(doc.total * rate)) && within(subtotalIls! + vatIls! + round2((doc.rounding ?? 0) * rate), totalIls!);
}

/**
 * D110 unit price and line total per item. Foreign lines are converted with the
 * rate and the last line absorbs the agorot, so the lines add up to
 * 1221 (after discount) + 1220 (discount) exactly.
 */
export function uniformLineAmounts(doc: InvoiceDocument, amounts: UniformAmounts = uniformAmounts(doc)): { unitPrice: number; total: number }[] {
  if (!amounts.foreign) return doc.items.map((item) => ({ unitPrice: item.unitPrice, total: item.total }));
  const totals = doc.items.map((item) => round2(item.total * amounts.rate));
  if (totals.length > 0) {
    const others = totals.slice(0, -1).reduce((sum, value) => sum + value, 0);
    totals[totals.length - 1] = round2(amounts.subtotal + amounts.discount - others);
  }
  return doc.items.map((item, index) => ({ unitPrice: round2(item.unitPrice * amounts.rate), total: totals[index] }));
}

/**
 * The shekel gap between the total and net + VAT, capped at the stored
 * rounding. The journal posts exactly this to the rounding account, so any gap
 * the stored rounding does not explain still unbalances the journal and blocks.
 */
export function journalRounding(amounts: UniformAmounts): number {
  const gap = round2(amounts.total - amounts.subtotal - amounts.vat);
  const posted = round2(Math.sign(gap) * Math.min(Math.abs(gap), amounts.roundingCap));
  return posted === 0 ? 0 : posted;
}

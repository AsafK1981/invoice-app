import { round2 } from "./vat";

export interface MoneyTriple {
  subtotal: number;
  vat: number;
  total: number;
}
export interface IlsTriple {
  subtotalIls: number;
  vatIls: number;
  totalIls: number;
}

/**
 * Snapshot the ₪ equivalent of a document's amounts at a given exchange
 * rate (₪ per 1 currency unit). Derives totalIls from the rounded parts so
 * the ₪ figures reconcile internally. For ILS docs the caller passes rate=1
 * → identical numbers.
 */
export function ilsEquivalents(m: MoneyTriple, rate: number): IlsTriple {
  const subtotalIls = round2(m.subtotal * rate);
  const vatIls = round2(m.vat * rate);
  return { subtotalIls, vatIls, totalIls: round2(subtotalIls + vatIls) };
}

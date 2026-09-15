// Pure decisions behind the document editor's exchange-rate field, kept out of
// receipt-editor.tsx so they are unit-tested without a browser.
//
// Why (audit 2026-09-15): the editor re-fetched the rate on every date change
// and overwrote a rate the user had typed or a resumed draft had saved, and it
// issued a USD document with the rate cleared (0, so total_ils = 0) or left at
// the starting 1 after a failed fetch. The filing reports already refuse such
// documents through foreignRateProblem; the editor now uses the same check, so
// what the editor lets through and what the reports accept agree.

import { foreignRateProblem } from "./fx-rate-sanity";

export interface PinnedRate {
  currency: string;
  date: string;
  rate: number;
}

export type RateAutoAction =
  | { kind: "ils" }
  /** Leave the rate as it is: the user typed it, or a resumed draft saved it. */
  | { kind: "keep" }
  /** A convert / credit note from a tax invoice keeps the source's rate. */
  | { kind: "pinned"; rate: number }
  | { kind: "fetch" };

/**
 * What the rate effect should do for the current currency and date. A rate the
 * user typed (or a resumed draft's valid saved rate) wins over everything;
 * changing the currency or pressing "refresh" clears that flag in the editor.
 */
export function rateAutoAction(args: {
  currency: string;
  date: string;
  userSetRate: boolean;
  pinned: PinnedRate | null;
}): RateAutoAction {
  if (args.currency === "ILS") return { kind: "ils" };
  if (args.userSetRate) return { kind: "keep" };
  const p = args.pinned;
  if (p && p.currency === args.currency && p.date === args.date) return { kind: "pinned", rate: p.rate };
  return { kind: "fetch" };
}

/** Whether a resumed draft's saved rate is a real rate worth keeping instead of fetching. */
export function isUsableSavedRate(currency: string, rate: number | undefined | null): boolean {
  if (currency === "ILS") return false;
  return foreignRateProblem(currency, rate ?? undefined) === null;
}

/**
 * Why a foreign-currency document cannot be issued at this rate, in one plain
 * Hebrew sentence, or null when the rate is fine (and always for ILS).
 */
export function exchangeRateBlockReason(currency: string, rate: number): string | null {
  const problem = foreignRateProblem(currency, rate);
  if (!problem) return null;
  const where = "בשדה שער החליפין (בהגדרות המתקדמות)";
  switch (problem) {
    case "missing":
      return `חסר שער חליפין של ${currency} לשקל. יש להזין את השער היציג לתאריך המסמך ${where}.`;
    case "one":
      return `שער החליפין של ${currency} עומד על 1, כנראה שהשער לא נטען. יש להזין את השער היציג לתאריך המסמך ${where}.`;
    case "out_of_range":
      return `שער החליפין של ${currency} (${rate}) לא נראה סביר. יש לבדוק ולתקן אותו ${where}.`;
  }
}

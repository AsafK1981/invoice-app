// Is a stored exchange rate plausible? The document editor starts the rate at
// 1 and keeps it when the rate fetch fails, and the database column defaults
// to 1, so "USD at 1" looks complete while it reports dollars as shekels.
// Shared by the PCN874 and the uniform structure preflights.

export type ForeignRateProblem = "missing" | "one" | "out_of_range";

/** Shekels per unit, generous bounds around every rate seen in years. Other currencies only get the generic checks. */
const SANE_RANGE: Record<string, readonly [number, number]> = {
  USD: [2, 7],
  EUR: [2, 7],
  GBP: [2, 7],
};

export function foreignRateProblem(currency: string | undefined, rate: number | undefined): ForeignRateProblem | null {
  if (!currency || currency === "ILS") return null;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return "missing";
  if (rate === 1) return "one";
  const range = SANE_RANGE[currency];
  if (range && (rate < range[0] || rate > range[1])) return "out_of_range";
  return null;
}

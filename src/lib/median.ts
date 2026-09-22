/**
 * The lower median: with an even count it takes the lower of the two middle
 * values instead of averaging them.
 *
 * That choice is deliberate and shared. An averaged half-day is not a payment
 * habit (recurring-patterns), an averaged half-shekel is not a forecast
 * (cash-flow-forecast), and two runs of the same report must never disagree by
 * rounding. Three files had private copies of this before 2026-09-22; keep one.
 */
export function lowerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

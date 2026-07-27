// Israeli tax thresholds, single source of truth used by the dashboard
// ceiling tracker, the business-type pickers (onboarding + settings),
// and the yearly check workflow.
//
// When a new year's ceiling is published by רשות המסים, add it here.
// The yearly cron in .github/workflows/exempt-ceiling-check.yml fires
// every January and pushes a WhatsApp reminder if a new year's ceiling
// is still missing from this table.
//
// Sources:
//   - סעיף 31 לחוק מס ערך מוסף (annual exempt threshold)
//   - https://www.gov.il/he/departments/general/value_added_tax
//   - Annual תקנות מס ערך מוסף published in Reshumot

export const EXEMPT_CEILING_BY_YEAR: Record<number, number> = {
  2024: 107_692,
  2025: 120_000,
  2026: 120_000, // unchanged through 2026-06; verify each January
};

/** Fallback when the requested year isn't in the table yet, used as
 *  a safe default so a stale build doesn't show ₪0. Should match the
 *  most recently published year. */
export const FALLBACK_EXEMPT_CEILING = 120_000;

export function getExemptCeiling(year: number): number {
  return EXEMPT_CEILING_BY_YEAR[year] ?? FALLBACK_EXEMPT_CEILING;
}

/** Latest year explicitly recorded, used by the picker help text so it
 *  reflects the most-recently-confirmed value rather than the runtime
 *  year (which might be missing if the table hasn't been updated yet). */
export function getLatestPublishedCeilingYear(): number {
  const years = Object.keys(EXEMPT_CEILING_BY_YEAR).map(Number);
  return Math.max(...years);
}

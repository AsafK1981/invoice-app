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
  // Corrected 2026-08-25. This read 120_000 with the note "unchanged through
  // 2026-06; verify each January" - the verification never happened, so the
  // 2025 figure was simply carried into 2026. The published 2026 ceiling is
  // 122,833. Confirmed against two independent sources (כל-זכות's עוסק פטור
  // entry, which states 122,833 for 2026 and 120,000 for 2025, and Bizportal's
  // 2026 guide) before changing it.
  //
  // Understating this is the dangerous direction: it drives the dashboard
  // ceiling tracker and the business-type picker, so a user turning over
  // ₪121,000 was being told they had passed the ceiling when they had not -
  // i.e. told to move to עוסק מורשה with ₪1,833 of headroom still left.
  2026: 122_833,
};

/** Fallback when the requested year isn't in the table yet, used as
 *  a safe default so a stale build doesn't show ₪0. Should match the
 *  most recently published year. */
export const FALLBACK_EXEMPT_CEILING = 122_833;

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

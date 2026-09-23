/**
 * How this software identifies itself to רשות המסים in every מבנה אחיד file
 * (A000 fields 1005-1010) and on the printed 5.4 report. One place, on
 * purpose: the registry certificate is issued for an exact name + version,
 * and the files, the printouts and the application form must all agree.
 *
 * - `name` is the name registered as a software house (API request #1973),
 *   deliberately NOT the 2026-07-29 consumer brand. Renaming it means
 *   re-registering.
 * - `version` 1.1 is the "מהדורה חדשה" רישום תוכנות asked for on 2026-09-06
 *   after the 20/05/2026 application (version 1.0) was auto-cancelled.
 * - `registrationNumber` stays "" until the certificate arrives. Field 1006
 *   is then written as FIRST_REGISTRATION_PLACEHOLDER, see below.
 */
export const UNIFORM_SOFTWARE = {
  name: "MySuperFriendlyInvoiceApp",
  version: "1.1",
  vendorName: "Asaf Kotler",
  vendorTaxId: "049040686",
  registrationNumber: "",
} as const;

/**
 * What A000 field 1006 carries while no certificate exists. רישום תוכנות said
 * on 2026-09-07 to write zeros, but the ITA simulator rejects a zeroed 1006
 * ("ערך השדה לא ולידי / השדה מאופס") and marks the whole run לקוי, which the
 * clerk then refused on 2026-09-23 ("עלי לקבל תוצאה תקינה"). Her own sample of
 * a valid first-registration run shows 00000001, and a run with 00000001
 * passed every check (input 230920261700). Replace with the real number by
 * setting UNIFORM_SOFTWARE.registrationNumber; this constant is never used
 * once that is set.
 */
export const FIRST_REGISTRATION_PLACEHOLDER = "00000001";

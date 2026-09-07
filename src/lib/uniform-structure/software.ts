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
 * - `registrationNumber` stays "" (written as 00000000, field 1006) until
 *   the certificate arrives; רישום תוכנות confirmed 2026-09-07 that zeros are
 *   the correct value for a first registration.
 */
export const UNIFORM_SOFTWARE = {
  name: "MySuperFriendlyInvoiceApp",
  version: "1.1",
  vendorName: "Asaf Kotler",
  vendorTaxId: "049040686",
  registrationNumber: "",
} as const;

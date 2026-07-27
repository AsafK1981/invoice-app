/**
 * Calendar-date helpers pinned to Israel time.
 *
 * On Vercel the server runs in UTC, and `new Date().toISOString().slice(0,10)`
 * therefore yields the UTC calendar date. For a user in Asia/Jerusalem creating
 * a document between midnight and ~02:00/03:00 local time, that UTC date is
 * still the PREVIOUS day, which stamps a legal document (invoice/receipt) with
 * the wrong date and, at a month/year boundary, files it in the wrong VAT
 * period or tax year. Always derive document/issue/period dates from these
 * helpers, never from raw `toISOString()`.
 */

/** Today's date as `YYYY-MM-DD` in Asia/Jerusalem, regardless of runtime TZ. */
export function todayInIsrael(): string {
  // en-CA formats as YYYY-MM-DD; timeZone pins the calendar day to Israel.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/** An existing Date's calendar day as `YYYY-MM-DD` in Asia/Jerusalem. */
export function toIsraelDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

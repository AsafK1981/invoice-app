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

/**
 * An existing Date's hour-of-day (0-23) in Asia/Jerusalem, DST-safe (never a
 * hardcoded UTC+2/+3 offset - `Intl` resolves the correct offset for the
 * given instant).
 */
export function toIsraelHour(d: Date): number {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "numeric",
    hour12: false,
  })
    .formatToParts(d)
    .find((p) => p.type === "hour");
  // Some environments render midnight as "24" with hour12:false; normalize.
  return hourPart ? Number(hourPart.value) % 24 : d.getUTCHours();
}

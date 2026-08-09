/**
 * Pure scheduling decision for the monthly reminder cron, extracted so it's
 * unit-testable without touching Supabase or the system clock. All date
 * arithmetic here is plain YYYY-MM-DD string/number math (see date.ts for
 * why we never use `Date#setMonth`/UTC offsets for Israel-local calendar
 * math) - callers pass in already-computed Israel-local date/hour values.
 */

const MAX_REMINDER_DAYS = 3;

/** Number of days in `month` (1-12) of `year`. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Clamps a chosen day-of-month (1-31) into a valid day for the given
 * year/month, e.g. 31 -> 28/29 in February, -> 30 in April/June/Sept/Nov.
 */
export function clampDayToMonth(year: number, month: number, day: number): number {
  const max = daysInMonth(year, month);
  return Math.max(1, Math.min(day, max));
}

/**
 * Validates/dedupes/truncates a raw days array from the DB or a form: keeps
 * only integers 1-31, drops duplicates, sorts ascending, and caps at
 * {@link MAX_REMINDER_DAYS} entries. Defensive mirror of the UI-side limit -
 * the DB column has no CHECK enforcing this, so a bad row must not break the
 * cron.
 */
export function sanitizeReminderDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31);
  const deduped = Array.from(new Set(valid)).sort((a, b) => a - b);
  return deduped.slice(0, MAX_REMINDER_DAYS);
}

export interface ReminderScheduleInput {
  /** Chosen days-of-month, 1-31, already sanitized (see {@link sanitizeReminderDays}). */
  days: number[];
  /** Chosen hour-of-day, 0-23, Asia/Jerusalem. */
  hour: number;
  /** `monthly_reminder_last_sent`, `YYYY-MM-DD` or null. */
  lastSent: string | null;
  /** Today's Asia/Jerusalem calendar date, `YYYY-MM-DD`. */
  todayIsrael: string;
  /** Current Asia/Jerusalem hour-of-day, 0-23. */
  currentHourIsrael: number;
}

/**
 * Decides whether a business's monthly reminder should fire on this cron
 * tick. Catch-up semantics: the cron runs hourly, so a business is a
 * candidate as soon as its chosen hour has been reached on (or passed) its
 * chosen day, and stays a candidate on every later hourly tick until it
 * actually sends - covering a transient failure earlier that day, or the
 * app being down at the exact hour.
 *
 * Rule: find the LATEST chosen day (clamped to this month's length) that is
 * `<= today`. If none exists, nothing to do. Otherwise this business should
 * send iff:
 *   - `lastSent` is null or strictly before that scheduled date, AND
 *   - today is already past the scheduled date (catch-up for an earlier,
 *     unsent day) OR the current hour has reached the chosen hour.
 *
 * Multiple chosen days per month each fire independently: sending for the
 * 1st stamps `lastSent` to the 1st, which does not block the 15th later
 * that same month, because the 15th's scheduled-date string sorts after it.
 *
 * Month-rollover catch-up: if the run that would have fired on the last
 * chosen day of a month never sent (e.g. the app was down through month
 * end), the current-month-only candidate set finds nothing to do once the
 * calendar has rolled to the next month and none of this month's chosen
 * days have arrived yet - there is no chosen day "<= today" in the new
 * month. In exactly that situation (no candidate day yet this month), we
 * additionally check the PREVIOUS month's latest scheduled day (clamped to
 * that month's length): if `lastSent` is still behind it, it's due,
 * unconditionally (any past date has already cleared the hour gate by
 * definition). This catch-up window is capped at exactly one previous
 * month - it does not cascade further back, and it never fires early for
 * a business whose chosen day has simply not arrived yet this month (that
 * stays governed by the normal same-month rule below).
 */
export function shouldSendMonthlyReminder(input: ReminderScheduleInput): boolean {
  const { days, hour, lastSent, todayIsrael, currentHourIsrael } = input;
  if (days.length === 0) return false;

  const [yearStr, monthStr, dayStr] = todayIsrael.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const todayDay = Number(dayStr);

  const scheduledDaysSoFar = days
    .map((d) => clampDayToMonth(year, month, d))
    .filter((d) => d <= todayDay);

  if (scheduledDaysSoFar.length === 0) {
    // Nothing scheduled yet this month - check for an unresolved previous
    // month's obligation before giving up.
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevLatestDay = Math.max(...days.map((d) => clampDayToMonth(prevYear, prevMonth, d)));
    const prevScheduledDateStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(prevLatestDay).padStart(2, "0")}`;
    // Require a real lastSent to treat this as an unresolved catch-up - a
    // `null` lastSent with no candidate day yet this month is simply a
    // business whose chosen day hasn't arrived yet (this month or ever),
    // not a missed prior obligation to make up for.
    return Boolean(lastSent) && (lastSent as string) < prevScheduledDateStr;
  }

  const latestScheduledDay = Math.max(...scheduledDaysSoFar);
  const scheduledDateStr = `${yearStr}-${monthStr}-${String(latestScheduledDay).padStart(2, "0")}`;

  if (lastSent && lastSent >= scheduledDateStr) return false;

  const isCatchUpFromEarlierDay = todayDay > latestScheduledDay;
  const hourReached = currentHourIsrael >= hour;

  return isCatchUpFromEarlierDay || hourReached;
}

/**
 * Pure "what's the next occurrence" helper for UI previews (e.g. "התזכורת
 * הבאה: יום שלישי, 1.9.2026 בשעה 09:00"). Not used by the cron itself - that
 * runs on {@link shouldSendMonthlyReminder}'s catch-up-aware logic - this is
 * purely informational, so it just finds the earliest candidate date
 * (this month or next) that is still >= today, or strictly in the future if
 * today's chosen hour has already passed.
 */
export function nextReminderOccurrence(
  days: number[],
  hour: number,
  todayIsrael: string,
  currentHourIsrael: number,
): Date | null {
  const sanitized = sanitizeReminderDays(days);
  if (sanitized.length === 0) return null;

  const [yearStr, monthStr, dayStr] = todayIsrael.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const todayDay = Number(dayStr);

  // Candidate dates: this month's chosen days that are still ahead (or today,
  // if the chosen hour hasn't passed yet), else roll to next month.
  const candidatesThisMonth = sanitized
    .map((d) => clampDayToMonth(year, month, d))
    .filter((d) => d > todayDay || (d === todayDay && currentHourIsrael < hour));

  if (candidatesThisMonth.length > 0) {
    const day = Math.min(...candidatesThisMonth);
    return new Date(year, month - 1, day, hour, 0, 0);
  }

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const day = Math.min(...sanitized.map((d) => clampDayToMonth(nextYear, nextMonth, d)));
  return new Date(nextYear, nextMonth - 1, day, hour, 0, 0);
}

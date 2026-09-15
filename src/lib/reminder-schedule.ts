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

/** Latest scheduled date (clamped per month) that is `<= dateStr`, or `< dateStr`
 *  when `strict`. Looks back as far as the previous month, which always has an
 *  occurrence, so the result is never null for a non-empty `days`. */
function latestOccurrence(days: number[], dateStr: string, strict: boolean): string | null {
  if (days.length === 0) return null;
  const [y, m] = dateStr.split("-").map(Number);
  let best: string | null = null;
  for (let back = 0; back <= 2 && !best; back++) {
    const month0 = m - 1 - back;
    const year = y + Math.floor(month0 / 12);
    const month = ((month0 % 12) + 12) % 12 + 1;
    for (const d of days) {
      const day = clampDayToMonth(year, month, d);
      const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const fits = strict ? candidate < dateStr : candidate <= dateStr;
      if (fits && (!best || candidate > best)) best = candidate;
    }
  }
  return best;
}

function daysBetween(fromStr: string, toStr: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toStr) - toUtc(fromStr)) / 86_400_000);
}

/**
 * How late the previous send may have been stamped and still count as proof
 * that the CURRENT schedule was active. A normal send stamps the scheduled day
 * itself; a catch-up after a short outage stamps a day or two later.
 */
const CATCH_UP_EVIDENCE_DAYS = 2;

/**
 * The scheduled date (`YYYY-MM-DD`) whose reminder is due on this cron tick,
 * or null. Shared by the cron ({@link shouldSendMonthlyReminder}) and the
 * settings preview ({@link nextReminderOccurrence}) so the two never disagree.
 *
 * Let D be the latest scheduled date `<= today` (this month or, right after a
 * month rollover, the previous one). D is due when `lastSent` is before D and:
 *   - D is today and the chosen hour has been reached (later hourly ticks the
 *     same day keep retrying a failed send), or
 *   - D already passed (a MISSED day) and there is evidence the reminder was
 *     running on this schedule back then: it was sent before, and that last
 *     send was on the occurrence right before D (or within
 *     {@link CATCH_UP_EVIDENCE_DAYS} after it).
 *
 * Why the evidence rule: there is no "settings changed at" column, so a day
 * that passed before the reminder was enabled, or before the day was changed,
 * looks exactly like a day the cron missed. Without the rule, enabling day 1
 * on the 20th, or moving day 25 to day 5 on the 10th, sent a reminder within
 * the hour while the settings page promised next month. A never-sent business
 * therefore only ever sends on the chosen day itself.
 */
export function dueReminderDate(input: ReminderScheduleInput): string | null {
  const { days, hour, lastSent, todayIsrael, currentHourIsrael } = input;
  const scheduled = latestOccurrence(days, todayIsrael, false);
  if (!scheduled) return null;
  if (lastSent && lastSent >= scheduled) return null;

  if (scheduled === todayIsrael) {
    return currentHourIsrael >= hour ? scheduled : null;
  }

  // Never sent: allow one day of catch-up, so a subscriber whose chosen-day
  // cron ticks were all skipped (GitHub schedules can drop runs) is not
  // silently pushed back a whole month. Anything older than that is a day
  // that passed before the reminder existed, not a missed send.
  if (!lastSent) return daysBetween(scheduled, todayIsrael) <= 1 ? scheduled : null;
  const previous = latestOccurrence(days, scheduled, true);
  if (!previous || lastSent < previous) return null;
  if (daysBetween(previous, lastSent) > CATCH_UP_EVIDENCE_DAYS) return null;
  return scheduled;
}

/**
 * Decides whether a business's monthly reminder should fire on this cron
 * tick. See {@link dueReminderDate} for the rule. Multiple chosen days per
 * month each fire independently: sending for the 1st stamps `lastSent` to the
 * 1st, which does not block the 15th later that same month.
 */
export function shouldSendMonthlyReminder(input: ReminderScheduleInput): boolean {
  return dueReminderDate(input) !== null;
}

/**
 * "What's the next occurrence" for the settings preview (e.g. "יום שלישי,
 * 1.9.2026 בשעה 09:00"). Pass the stored `lastSent` so the preview agrees
 * with the cron: when a reminder is already due (today's hour passed and it
 * has not gone out yet, or a genuinely missed day will be caught up), the
 * answer is today, at the current hour, since the next hourly tick sends it.
 * Otherwise it is the earliest chosen day still ahead, this month or next.
 */
export function nextReminderOccurrence(
  days: number[],
  hour: number,
  todayIsrael: string,
  currentHourIsrael: number,
  lastSent: string | null = null,
): Date | null {
  const sanitized = sanitizeReminderDays(days);
  if (sanitized.length === 0) return null;

  const [yearStr, monthStr, dayStr] = todayIsrael.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const todayDay = Number(dayStr);

  if (
    dueReminderDate({ days: sanitized, hour, lastSent, todayIsrael, currentHourIsrael }) !== null
  ) {
    return new Date(year, month - 1, todayDay, currentHourIsrael, 0, 0);
  }

  // A today occurrence counts only while its hour is still ahead, and only if
  // it has not already been sent today.
  const sentToday = lastSent !== null && lastSent >= todayIsrael;
  const candidatesThisMonth = sanitized
    .map((d) => clampDayToMonth(year, month, d))
    .filter((d) => d > todayDay || (d === todayDay && currentHourIsrael < hour && !sentToday));

  if (candidatesThisMonth.length > 0) {
    const day = Math.min(...candidatesThisMonth);
    return new Date(year, month - 1, day, hour, 0, 0);
  }

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const day = Math.min(...sanitized.map((d) => clampDayToMonth(nextYear, nextMonth, d)));
  return new Date(nextYear, nextMonth - 1, day, hour, 0, 0);
}

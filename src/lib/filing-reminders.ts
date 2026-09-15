// Which filing-deadline reminders are due today, for one business. Pure, so
// the daily cron (src/app/api/cron/filing-reminders/route.ts) stays a thin
// loop and the rules are tested without a database.
//
// A reminder goes out once per deadline: when the deadline is within the
// owner's "days before" window (today included), not marked as filed, and not
// reminded before. The `reminded` map on filing_preferences records it, so a
// retried or doubled cron run never notifies twice.

import type { Business } from "./types";
import { formatDate } from "./format";
import { OBLIGATIONS, daysUntil, obligationOccurrences, relativeDayLabel, type ObligationOccurrence } from "./ita/filing-calendar";
import type { FilingSettings } from "./filing-settings";

export interface ReminderInput {
  businessType: Business["businessType"];
  settings: FilingSettings;
  filed: Record<string, string>;
  reminded: Record<string, string>;
  /** ISO date in Israel time. */
  today: string;
}

export interface PlannedReminder {
  occurrence: ObligationOccurrence;
  title: string;
  body: string;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function planFilingReminders(input: ReminderInput): PlannedReminder[] {
  const { settings, filed, reminded, today } = input;
  if (!settings.remindersEnabled) return [];
  const until = addDays(today, settings.reminderDaysBefore);
  return obligationOccurrences(input.businessType, settings, today, until)
    .filter((o) => !filed[o.key] && !reminded[o.key] && daysUntil(o.date, today) >= 0)
    .map((o) => {
      const info = OBLIGATIONS[o.id];
      const online = o.onlineDate && o.onlineDate !== o.date ? ` בדיווח ותשלום באתר אפשר עד ${formatDate(o.onlineDate)}.` : "";
      return {
        occurrence: o,
        title: `${info.title} · ${o.periodLabel}: ${relativeDayLabel(o.date, today)}`,
        body: `המועד האחרון הוא ${formatDate(o.date)}.${online} בלוח חובות ההגשה יש את כל הפרטים, וסימון "הגשתי" מפסיק את התזכורות.`,
      };
    });
}

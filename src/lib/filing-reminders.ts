// Which filing-deadline reminders are due today, for one business. Pure, so
// the daily cron (src/app/api/cron/filing-reminders/route.ts) stays a thin
// loop and the rules are tested without a database.
//
// A reminder goes out once per deadline: when the deadline is within the
// owner's "days before" window (today included), not marked as filed, and not
// reminded before. The `reminded` map on filing_preferences records it, so a
// retried or doubled cron run never notifies twice.

import type { Business } from "./types";
import { formatCurrencyWhole, formatDate } from "./format";
import { OBLIGATIONS, daysUntil, obligationOccurrences, relativeDayLabel, type ObligationOccurrence } from "./ita/filing-calendar";
import type { FilingSettings } from "./filing-settings";
import { periodOfOccurrence, type ReminderAmount } from "./filing-amounts";

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
      const { title, body } = reminderText(o, today, null);
      return { occurrence: o, title, body };
    });
}

/**
 * The notification text for one deadline, with the amount when the cron
 * resolved one (src/lib/filing-amounts.ts). A null amount gives the plain
 * deadline text. The VAT report and the advance link to the periodic filing
 * report of that period, where the same figures are shown in full.
 */
export function reminderText(o: ObligationOccurrence, today: string, amount: ReminderAmount | null): { title: string; body: string; href: string } {
  const info = OBLIGATIONS[o.id];
  const D = formatDate(o.date);
  const online = o.onlineDate && o.onlineDate !== o.date ? ` בדיווח ותשלום באתר אפשר עד ${formatDate(o.onlineDate)}.` : "";
  const plain = `המועד האחרון הוא ${D}.${online} בלוח חובות ההגשה יש את כל הפרטים, וסימון "הגשתי" מפסיק את התזכורות.`;
  const title = `${info.title} · ${o.periodLabel}: ${relativeDayLabel(o.date, today)}`;
  const tag = periodOfOccurrence(o);
  const href = tag && (o.id === "vat_periodic" || o.id === "income_tax_advance") ? `/reports/periodic?period=${tag}` : "/obligations";
  return { title, body: reminderBody(amount, D, online, plain), href };
}

function reminderBody(amount: ReminderAmount | null, D: string, online: string, plain: string): string {
  if (!amount) return plain;
  switch (amount.status) {
    case "pay": {
      const amt = formatCurrencyWhole(amount.amount);
      if (amount.source === "vat") return `לתשלום ${amt} עד ${D}, לפי המסמכים וההוצאות באפליקציה.${online}`;
      if (amount.source === "advance") return `מקדמה של ${amt} לתשלום עד ${D}${amount.detail ? ` (${amount.detail})` : ""}.${online}`;
      return `${amt} לתשלום עד ${D}, לפי הסכום שהזנת בלוח חובות ההגשה.`;
    }
    case "refund":
      return `החזר של ${formatCurrencyWhole(amount.amount)} מגיע לך לפי הדוח. המועד האחרון להגשה הוא ${D}.${online}`;
    case "zero":
      if (amount.source === "vat") return `אין מה לשלם הפעם, אבל צריך להגיש דוח אפס עד ${D}.${online}`;
      if (amount.offsetInFull && amount.amount !== undefined)
        return `המקדמה לתקופה הזו (${formatCurrencyWhole(amount.amount)}) מכוסה במלואה בניכוי במקור, אין מה לשלם. המועד להגשה הוא ${D}.${online}`;
      return `לא יצאה מקדמה לתקופה הזו (אין מחזור). המועד להגשה הוא ${D}.${online}`;
    case "missing":
      if (amount.reason === "no_rate") return `${plain} כדי לקבל את הסכום בתזכורת, הזן את שיעור המקדמות בדוח המקדמות.`;
      if (amount.reason === "unavailable") return plain;
      if (amount.reason === "no_btl_amount") return `${plain} כדי לקבל את הסכום בתזכורת, הזן את מקדמת ביטוח לאומי החודשית בהגדרות הלוח.`;
      return `${plain} הסכום לא חושב כי בדוח התקופתי יש נתונים שצריך לתקן.`;
  }
}

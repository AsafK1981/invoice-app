"use client";

import { CalendarClock } from "lucide-react";
import { MonthlyReminderSettingsSection } from "@/components/monthly-reminder-settings-section";
import { DunningSettingsSection } from "@/components/dunning-settings-section";

/**
 * /reminders - every reminder the app can send, on one page.
 *
 * Split out of /notifications on 2026-08-19: the notification centre is
 * the feed of what already happened; this page is where the user decides
 * what the app sends (to them and to their clients) and when. Keeping the
 * two apart means reminders are no longer hidden behind a tab.
 */
export default function RemindersPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl fgrad fgrad-orange flex items-center justify-center shadow-sm">
            <CalendarClock className="w-5 h-5 text-white" />
          </span>
          תזכורות
        </h1>
        <p className="text-sm text-stone-700 mt-2 mr-14">
          מתי ואיך תזכורות נשלחות אליך וללקוחות שלך
        </p>
      </div>

      <div className="space-y-5 max-w-3xl">
        <MonthlyReminderSettingsSection />
        <DunningSettingsSection />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CalendarOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { useBusiness, saveBusiness } from "@/lib/business-store";

export function MonthlyReminderSettingsSection() {
  const { business, ready, refetch } = useBusiness();
  const [enabled, setEnabled] = useState(false);
  const [day, setDay] = useState<1 | 15>(1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (ready) {
      setEnabled(business.monthlyReminderEnabled ?? false);
      setDay(business.monthlyReminderDay ?? 1);
    }
  }, [ready, business.monthlyReminderEnabled, business.monthlyReminderDay]);

  async function persist(nextEnabled: boolean, nextDay: 1 | 15) {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      await saveBusiness({
        ...business,
        monthlyReminderEnabled: nextEnabled,
        monthlyReminderDay: nextDay,
      });
      await refetch();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-soft p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center flex-shrink-0">
          {enabled ? (
            <CalendarClock className="w-4 h-4 text-orange-700" />
          ) : (
            <CalendarOff className="w-4 h-4 text-stone-500" />
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-stone-900">תזכורת חודשית להוצאת מסמכים</h3>
          <p className="text-sm text-stone-700 mt-1">
            נשלח במייל רק אם יש משהו פתוח - בלי ספאם.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => {
              const next = e.target.checked;
              setEnabled(next);
              persist(next, day);
            }}
            className="w-5 h-5 rounded text-orange-500 focus:ring-orange-500"
          />
          <span className="text-sm font-medium text-stone-900">
            הפעלת תזכורת חודשית
          </span>
        </label>

        {enabled && (
          <div className="pl-8">
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              יום בחודש לבדיקה
            </label>
            <div className="flex items-stretch gap-2 flex-wrap">
              {([1, 15] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDay(d);
                    persist(enabled, d);
                  }}
                  disabled={saving}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 disabled:opacity-50 ${
                    day === d
                      ? "bg-gradient-to-br from-amber-100 to-orange-100 border-orange-300 text-orange-800"
                      : "bg-white border-stone-200 text-stone-700 hover:border-orange-200"
                  }`}
                >
                  ה-{d} לחודש
                </button>
              ))}
            </div>
            <p className="text-xs text-stone-500 mt-1.5">
              בכל חודש, ביום הזה, נבדוק אם יש הצעות מחיר או חשבונות עסקה פתוחים, לקוחות קבועים שלא קיבלו מסמך החודש, ומסמכים שלא שולמו - ונשלח מייל רק אם באמת יש מה לדווח.
            </p>
          </div>
        )}
      </div>

      {saved && (
        <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4" />
          נשמר
        </div>
      )}
      {err && (
        <div className="mt-4 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}
    </div>
  );
}

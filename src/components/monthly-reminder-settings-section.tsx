"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CalendarOff, AlertCircle, CheckCircle2, Plus, X } from "lucide-react";
import { useBusiness, saveBusiness } from "@/lib/business-store";
import { sanitizeReminderDays } from "@/lib/reminder-schedule";

const MAX_DAYS = 3;
const HOUR_OPTIONS = Array.from({ length: 17 }, (_, i) => i + 6); // 06:00 .. 22:00
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

function dayLabel(day: number): string {
  return `ב-${day} לחודש`;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function MonthlyReminderSettingsSection() {
  const { business, ready, refetch } = useBusiness();
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState<number[]>([1]);
  const [hour, setHour] = useState(9);
  const [emailOn, setEmailOn] = useState(true);
  const [inappOn, setInappOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (ready) {
      setEnabled(business.monthlyReminderEnabled ?? false);
      setDays(
        business.monthlyReminderDays && business.monthlyReminderDays.length > 0
          ? sanitizeReminderDays(business.monthlyReminderDays)
          : [1],
      );
      setHour(business.monthlyReminderHour ?? 9);
      const channels = business.monthlyReminderChannels ?? ["email", "inapp"];
      setEmailOn(channels.includes("email"));
      setInappOn(channels.includes("inapp"));
    }
  }, [
    ready,
    business.monthlyReminderEnabled,
    business.monthlyReminderDays,
    business.monthlyReminderHour,
    business.monthlyReminderChannels,
  ]);

  async function persist(next: {
    enabled: boolean;
    days: number[];
    hour: number;
    emailOn: boolean;
    inappOn: boolean;
  }) {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const channels: string[] = [];
      if (next.emailOn) channels.push("email");
      if (next.inappOn) channels.push("inapp");
      await saveBusiness({
        ...business,
        monthlyReminderEnabled: next.enabled,
        monthlyReminderDays: sanitizeReminderDays(next.days),
        monthlyReminderHour: next.hour,
        monthlyReminderChannels: channels,
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

  function addDay() {
    // First unused day, so "הוסף יום תזכורת" always has an obvious effect.
    const nextDay = DAY_OPTIONS.find((d) => !days.includes(d)) ?? 1;
    const nextDays = [...days, nextDay].sort((a, b) => a - b);
    setDays(nextDays);
    persist({ enabled, days: nextDays, hour, emailOn, inappOn });
  }

  function removeDay(day: number) {
    if (days.length <= 1) return; // at least one day required
    const nextDays = days.filter((d) => d !== day);
    setDays(nextDays);
    persist({ enabled, days: nextDays, hour, emailOn, inappOn });
  }

  function changeDay(index: number, newDay: number) {
    if (days.includes(newDay)) return; // already selected in another row - no-op
    const nextDays = days.map((d, i) => (i === index ? newDay : d)).sort((a, b) => a - b);
    setDays(nextDays);
    persist({ enabled, days: nextDays, hour, emailOn, inappOn });
  }

  function changeHour(newHour: number) {
    setHour(newHour);
    persist({ enabled, days, hour: newHour, emailOn, inappOn });
  }

  function toggleChannel(channel: "email" | "inapp") {
    const nextEmailOn = channel === "email" ? !emailOn : emailOn;
    const nextInappOn = channel === "inapp" ? !inappOn : inappOn;
    if (!nextEmailOn && !nextInappOn) {
      setErr("חייב להישאר לפחות ערוץ אחד פעיל (מייל או התראה באפליקציה).");
      return;
    }
    setErr(null);
    setEmailOn(nextEmailOn);
    setInappOn(nextInappOn);
    persist({ enabled, days, hour, emailOn: nextEmailOn, inappOn: nextInappOn });
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
            נשלח רק אם יש משהו פתוח - בלי ספאם.
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
              persist({ enabled: next, days, hour, emailOn, inappOn });
            }}
            className="w-5 h-5 rounded text-orange-500 focus:ring-orange-500"
          />
          <span className="text-sm font-medium text-stone-900">
            הפעלת תזכורת חודשית
          </span>
        </label>

        {enabled && (
          <div className="pl-8 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                באילו ימים בחודש
              </label>
              <div className="space-y-2">
                {days.map((day, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <select
                      value={day}
                      disabled={saving}
                      onChange={(e) => changeDay(index, Number(e.target.value))}
                      className="px-3 py-2 rounded-xl text-sm font-semibold border-2 border-stone-200 bg-white text-stone-700 disabled:opacity-50 focus:border-orange-300 focus:outline-none"
                    >
                      {DAY_OPTIONS.map((d) => (
                        <option key={d} value={d} disabled={d !== day && days.includes(d)}>
                          {dayLabel(d)}
                        </option>
                      ))}
                    </select>
                    {days.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDay(day)}
                        disabled={saving}
                        aria-label="הסר יום"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-500 hover:bg-stone-100 hover:text-rose-600 disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {days.length < MAX_DAYS && (
                <button
                  type="button"
                  onClick={addDay}
                  disabled={saving}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-700 hover:text-orange-800 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  הוסף יום תזכורת
                </button>
              )}
              <p className="text-xs text-stone-500 mt-1.5">
                יום 29-31 יישלח ביום האחרון של חודש קצר.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                באיזו שעה
              </label>
              <select
                value={hour}
                disabled={saving}
                onChange={(e) => changeHour(Number(e.target.value))}
                className="px-3 py-2 rounded-xl text-sm font-semibold border-2 border-stone-200 bg-white text-stone-700 disabled:opacity-50 focus:border-orange-300 focus:outline-none"
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                איך לשלוח
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={emailOn}
                    disabled={saving}
                    onChange={() => toggleChannel("email")}
                    className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-stone-800">מייל</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inappOn}
                    disabled={saving}
                    onChange={() => toggleChannel("inapp")}
                    className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-stone-800">התראה באפליקציה</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-not-allowed opacity-60">
                  <input type="checkbox" checked={false} disabled className="w-4 h-4 rounded" />
                  <span className="text-sm text-stone-500">וואטסאפ (בקרוב)</span>
                </label>
              </div>
            </div>

            <p className="text-xs text-stone-500">
              בכל תאריך שבחרת נבדוק אם יש הצעות מחיר או חשבונות עסקה פתוחים, לקוחות קבועים שלא קיבלו מסמך החודש, ומסמכים שלא שולמו - ונשלח רק אם באמת יש מה לדווח.
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

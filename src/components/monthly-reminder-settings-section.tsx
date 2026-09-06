"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarOff,
  AlertCircle,
  Plus,
  X,
  Mail,
  Bell,
  MessageCircle,
} from "lucide-react";
import { useBusiness, saveBusiness } from "@/lib/business-store";
import { sanitizeReminderDays, nextReminderOccurrence } from "@/lib/reminder-schedule";
import { todayInIsrael, toIsraelHour } from "@/lib/date";
import { useToast } from "@/components/ui/toast";

const MAX_DAYS = 3;
const HOUR_OPTIONS = Array.from({ length: 17 }, (_, i) => i + 6); // 06:00 .. 22:00
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

function dayLabel(day: number): string {
  return `ב-${day} בחודש`;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

interface Draft {
  enabled: boolean;
  days: number[];
  hour: number;
  emailOn: boolean;
  inappOn: boolean;
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return (
    a.enabled === b.enabled &&
    a.hour === b.hour &&
    a.emailOn === b.emailOn &&
    a.inappOn === b.inappOn &&
    a.days.length === b.days.length &&
    a.days.every((d, i) => d === b.days[i])
  );
}

export function MonthlyReminderSettingsSection() {
  const { business, ready, refetch } = useBusiness();
  const showToast = useToast();

  const [draft, setDraft] = useState<Draft>({
    enabled: false,
    days: [1],
    hour: 9,
    emailOn: true,
    inappOn: true,
  });
  const [baseline, setBaseline] = useState<Draft>(draft);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const channels = business.monthlyReminderChannels ?? ["email", "inapp"];
    const loaded: Draft = {
      enabled: business.monthlyReminderEnabled ?? false,
      days:
        business.monthlyReminderDays && business.monthlyReminderDays.length > 0
          ? sanitizeReminderDays(business.monthlyReminderDays)
          : [1],
      hour: business.monthlyReminderHour ?? 9,
      emailOn: channels.includes("email"),
      inappOn: channels.includes("inapp"),
    };
    setDraft(loaded);
    setBaseline(loaded);
  }, [
    ready,
    business.monthlyReminderEnabled,
    business.monthlyReminderDays,
    business.monthlyReminderHour,
    business.monthlyReminderChannels,
  ]);

  const dirty = !draftsEqual(draft, baseline);

  const preview = useMemo(() => {
    if (!draft.enabled) return null;
    const next = nextReminderOccurrence(draft.days, draft.hour, todayInIsrael(), toIsraelHour(new Date()));
    if (!next) return null;
    const dateLabel = next.toLocaleDateString("he-IL", {
      weekday: "long",
      day: "numeric",
      month: "numeric",
      year: "numeric",
    });
    return `${dateLabel} בשעה ${hourLabel(draft.hour)}`;
  }, [draft.enabled, draft.days, draft.hour]);

  async function handleSave() {
    if (!draft.emailOn && !draft.inappOn) {
      setErr("חייב להישאר לפחות ערוץ אחד פעיל (מייל או התראה באפליקציה).");
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const channels: string[] = [];
      if (draft.emailOn) channels.push("email");
      if (draft.inappOn) channels.push("inapp");
      await saveBusiness({
        ...business,
        monthlyReminderEnabled: draft.enabled,
        monthlyReminderDays: sanitizeReminderDays(draft.days),
        monthlyReminderHour: draft.hour,
        monthlyReminderChannels: channels,
      });
      await refetch();
      setBaseline(draft);
      showToast("הגדרות התזכורת החודשית נשמרו", "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : "שגיאה בשמירה";
      setErr(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  function addDay(day: number) {
    setDraft((d) => ({ ...d, days: [...d.days, day].sort((a, b) => a - b) }));
    setAddOpen(false);
  }

  function removeDay(day: number) {
    setDraft((d) => (d.days.length <= 1 ? d : { ...d, days: d.days.filter((x) => x !== day) }));
  }

  const availableDays = DAY_OPTIONS.filter((d) => !draft.days.includes(d));

  return (
    <div className="card-soft p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center flex-shrink-0">
          {draft.enabled ? (
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
            checked={draft.enabled}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
            className="w-5 h-5 rounded text-orange-500 focus:ring-orange-500"
          />
          <span className="text-sm font-medium text-stone-900">
            הפעלת תזכורת חודשית
          </span>
        </label>

        {draft.enabled && (
          <div className="pl-8 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-2">
                באילו ימים בחודש
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {draft.days.map((day) => (
                  <span
                    key={day}
                    className="inline-flex items-center gap-1.5 pr-3 pl-1.5 py-1.5 rounded-full text-sm font-semibold bg-orange-50 border border-orange-200 text-orange-800"
                  >
                    {dayLabel(day)}
                    {draft.days.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDay(day)}
                        aria-label={`הסר ${dayLabel(day)}`}
                        className="w-5 h-5 rounded-full flex items-center justify-center text-orange-600 hover:bg-orange-200/70 hover:text-rose-700"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}

                {draft.days.length < MAX_DAYS && !addOpen && (
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    className="inline-flex items-center gap-1.5 pr-3 pl-3 py-1.5 rounded-full text-sm font-semibold border-2 border-dashed border-stone-300 text-stone-600 hover:border-orange-300 hover:text-orange-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    הוסף יום
                  </button>
                )}

                {addOpen && (
                  <select
                    autoFocus
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) addDay(Number(e.target.value));
                    }}
                    onBlur={() => setAddOpen(false)}
                    className="px-3 py-1.5 rounded-full text-sm font-semibold border-2 border-orange-200 bg-white text-stone-700 focus:border-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
                  >
                    <option value="" disabled>
                      בחר יום
                    </option>
                    {availableDays.map((d) => (
                      <option key={d} value={d}>
                        {dayLabel(d)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="text-xs text-stone-500 mt-1.5">
                יום 29-31 יישלח ביום האחרון של חודש קצר.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                באיזו שעה
              </label>
              <select
                value={draft.hour}
                onChange={(e) => setDraft((d) => ({ ...d, hour: Number(e.target.value) }))}
                className="px-3 py-2 rounded-xl text-sm font-semibold border-2 border-stone-200 bg-white text-stone-700 focus:border-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
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
                    checked={draft.emailOn}
                    onChange={() => setDraft((d) => ({ ...d, emailOn: !d.emailOn }))}
                    className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500"
                  />
                  <Mail className="w-4 h-4 text-stone-500" />
                  <span className="text-sm text-stone-800">מייל</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.inappOn}
                    onChange={() => setDraft((d) => ({ ...d, inappOn: !d.inappOn }))}
                    className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500"
                  />
                  <Bell className="w-4 h-4 text-stone-500" />
                  <span className="text-sm text-stone-800">התראה באפליקציה</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-not-allowed opacity-60">
                  <input type="checkbox" checked={false} disabled className="w-4 h-4 rounded" />
                  <MessageCircle className="w-4 h-4 text-stone-400" />
                  <span className="text-sm text-stone-500">וואטסאפ (בקרוב)</span>
                </label>
              </div>
            </div>

            {preview && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-sm text-emerald-900">
                התזכורת הבאה: {preview}
              </div>
            )}

            <p className="text-xs text-stone-500">
              בכל תאריך שבחרת נבדוק אם יש הצעות מחיר או חשבונות עסקה פתוחים, לקוחות קבועים שלא קיבלו מסמך החודש, ומסמכים שלא שולמו - ונשלח רק אם באמת יש מה לדווח.
            </p>
          </div>
        )}
      </div>

      <div className="mt-5 pt-4 border-t border-stone-100 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-orange-700 hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none disabled:cursor-not-allowed transition-all"
        >
          {saving ? "שומר..." : "שמירה"}
        </button>
        {dirty && !saving && (
          <span className="text-xs font-medium text-amber-700">יש שינויים שלא נשמרו</span>
        )}
      </div>

      {err && (
        <div className="mt-4 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}
    </div>
  );
}

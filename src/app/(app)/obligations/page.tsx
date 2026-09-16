"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck, Check, ChevronLeft, ChevronRight, ExternalLink, Settings2 } from "lucide-react";
import { useBusiness } from "@/lib/business-store";
import { useToast } from "@/components/ui/toast";
import { todayInIsrael } from "@/lib/date";
import { formatDate } from "@/lib/format";
import {
  AUTHORITY_LABELS,
  OBLIGATIONS,
  OFFICIAL_CALENDAR_URL,
  filesVat,
  obligationOccurrences,
  relativeDayLabel,
  daysUntil,
  type Authority,
  type Cadence,
  type ObligationOccurrence,
} from "@/lib/ita/filing-calendar";
import { ensureFilingRow, saveFilingSettings, setDeadlineFiled, useFilingPreferences, type FilingSettings } from "@/lib/filing-preferences-store";

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

/**
 * One tone per authority, from the brand's approved three-tone rotation
 * (the .ftile-* orange / charcoal / green in app-skin.css). Literal colours on
 * purpose: the brand theme remaps Tailwind's indigo/cyan/fuchsia scales to
 * near-identical greys, which made the three authorities indistinguishable.
 */
const TONE: Record<Authority, { bg: string; line: string; ink: string; dot: string }> = {
  vat: { bg: "#fbeadb", line: "#f3d2b4", ink: "#A94E16", dot: "#D96A1D" },
  tax: { bg: "#e9e8e5", line: "#d6d4d0", ink: "#2C2F36", dot: "#1F232B" },
  btl: { bg: "#eef4e8", line: "#c8ddb6", ink: "#4A7536", dot: "#5E8F45" },
};
const toneStyle = (a: Authority) => ({ backgroundColor: TONE[a].bg, borderColor: TONE[a].line, color: TONE[a].ink });

const pad2 = (n: number) => String(n).padStart(2, "0");
const monthBounds = (y: number, m: number) => ({ start: `${y}-${pad2(m + 1)}-01`, end: `${y}-${pad2(m + 1)}-${pad2(new Date(y, m + 1, 0).getDate())}` });

/**
 * חובות הגשה: every filing an Israeli freelancer owes, on a month calendar.
 * Click a day to see what is due, what it asks for, where and how to file,
 * and the in-app report that prepares it. Dates come from
 * src/lib/ita/filing-calendar.ts (the Tax Authority's published 2026 table).
 */
export default function ObligationsPage() {
  const { business, ready } = useBusiness();
  const toast = useToast();
  const { state, error, refresh } = useFilingPreferences(ready ? business.id : "");
  const today = todayInIsrael();
  const [view, setView] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [selected, setSelected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Opening the calendar creates the owner's settings row (defaults, never
  // overwritten). That row is what the daily reminder cron looks at, so the
  // reminders shown on this page only start once the owner has seen them.
  const businessId = ready ? business.id : "";
  useEffect(() => {
    if (!businessId) return;
    ensureFilingRow(businessId)
      .then((created) => {
        if (!created) return;
        refresh();
        setSettingsOpen(true);
      })
      .catch(() => {
        /* The page still works on defaults; the next visit tries again. */
      });
  }, [businessId, refresh]);

  const settings = state?.settings;
  // A tick shows at once; the stored map replaces the override when it reloads.
  const [pendingFiled, setPendingFiled] = useState<Record<string, boolean>>({});
  const filed = useMemo(() => {
    const merged: Record<string, string> = { ...(state?.filed ?? {}) };
    for (const [key, on] of Object.entries(pendingFiled)) {
      if (on) merged[key] = merged[key] ?? "pending";
      else delete merged[key];
    }
    return merged;
  }, [state, pendingFiled]);
  const type = business.businessType;

  // Deadlines for the visible month, and for the next 400 days (the "next up" line and the default selection).
  const monthOcc = useMemo(() => {
    if (!settings) return [];
    const { start, end } = monthBounds(view.y, view.m);
    return obligationOccurrences(type, settings, start, end);
  }, [settings, type, view]);
  const upcoming = useMemo(() => {
    if (!settings) return [];
    const [y, m, d] = today.split("-").map(Number);
    const until = `${y + 1}-${pad2(m)}-${pad2(Math.min(d, 28))}`;
    return obligationOccurrences(type, settings, today, until).filter((o) => !filed[o.key]);
  }, [settings, type, today, filed]);

  // Open on the next deadline that is not filed yet, once the data is in.
  useEffect(() => {
    if (selected || upcoming.length === 0) return;
    const next = upcoming[0];
    setSelected(next.date);
    setView({ y: Number(next.date.slice(0, 4)), m: Number(next.date.slice(5, 7)) - 1 });
  }, [upcoming, selected]);

  const byDay = useMemo(() => {
    const map = new Map<string, ObligationOccurrence[]>();
    for (const o of monthOcc) map.set(o.date, [...(map.get(o.date) ?? []), o]);
    return map;
  }, [monthOcc]);

  const selectedOcc = selected ? obligationsOn(selected, settings, type) : [];

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  async function toggleFiled(key: string, value: boolean) {
    setBusyKey(key);
    setPendingFiled((p) => ({ ...p, [key]: value }));
    try {
      await setDeadlineFiled(business.id, key, value);
    } catch {
      setPendingFiled((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
      toast("השמירה נכשלה. נסו שוב.");
    } finally {
      setBusyKey(null);
    }
  }

  // Once the stored marks agree with a pending tick, drop the override.
  useEffect(() => {
    if (!state) return;
    setPendingFiled((p) => {
      const next = { ...p };
      let changed = false;
      for (const [key, on] of Object.entries(p)) {
        if (Boolean(state.filed[key]) === on) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : p;
    });
  }, [state]);

  async function saveSetting(patch: Partial<FilingSettings>) {
    try {
      await saveFilingSettings(business.id, patch);
    } catch {
      toast("שמירת ההגדרה נכשלה. נסו שוב.");
      refresh();
    }
  }

  const first = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const next = upcoming[0];

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
              <CalendarCheck className="w-5 h-5 text-white" aria-hidden="true" />
            </span>
            חובות הגשה
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            מי מגיש, מה, מתי, איפה ואיך{ready ? `, מותאם ל${type === "company" ? "חברה" : filesVat(type) ? "עוסק מורשה" : "עוסק פטור"}` : ""}. לחצו על יום מסומן בלוח.
          </p>
        </div>
        <button type="button" className="pgbtn pgbtn-quiet" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((o) => !o)}>
          <Settings2 aria-hidden="true" />
          ההגדרות שלי
        </button>
      </div>

      {!ready || (!state && !error) ? (
        <p role="status" className="py-16 text-center text-stone-600">טוען את מועדי ההגשה...</p>
      ) : error ? (
        <div role="alert" className="p-6 rounded-2xl bg-amber-50 text-amber-900">
          <p>לא הצלחנו לטעון את ההגדרות. {error}</p>
          <button type="button" className="pgbtn pgbtn-quiet mt-3" onClick={refresh}>ניסיון נוסף</button>
        </div>
      ) : settings ? (
        <>
          <p className="text-sm text-stone-700 -mt-2">
            {settings.remindersEnabled
              ? `תזכורת תופיע בהתראות ${settings.reminderDaysBefore === 1 ? "יום אחד" : `${settings.reminderDaysBefore} ימים`} לפני כל מועד שלא סומן כהוגש.`
              : "התזכורות לפני המועדים כבויות."}{" "}
            <button type="button" className="font-semibold text-orange-700 underline" onClick={() => setSettingsOpen(true)}>
              {settings.remindersEnabled ? "שינוי" : "הפעלה"}
            </button>
          </p>

          {settingsOpen && <SettingsCard settings={settings} vat={filesVat(type)} onChange={saveSetting} />}

          {next && (
            <button
              type="button"
              onClick={() => {
                setSelected(next.date);
                setView({ y: Number(next.date.slice(0, 4)), m: Number(next.date.slice(5, 7)) - 1 });
              }}
              className="w-full text-right flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-stone-200 bg-white px-4 py-3 hover:bg-orange-50/40"
            >
              <span className="text-xs font-bold text-stone-600">ההגשה הבאה</span>
              <span className="font-bold text-stone-900">{OBLIGATIONS[next.id].title} · {next.periodLabel}</span>
              <span className="tabular-nums font-semibold text-stone-800">{formatDate(next.date)}</span>
              <DuePill date={next.date} today={today} />
            </button>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-5 items-start">
            {/* ---------- month calendar ---------- */}
            <section aria-label="לוח מועדי הגשה" className="rounded-2xl border border-stone-200 bg-white p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <button type="button" className="pgbtn pgbtn-quiet" onClick={() => shiftMonth(-1)} aria-label="חודש קודם">
                  <ChevronRight aria-hidden="true" />
                </button>
                <h2 className="text-lg font-bold text-stone-900" aria-live="polite">{MONTHS[view.m]} {view.y}</h2>
                <button type="button" className="pgbtn pgbtn-quiet" onClick={() => shiftMonth(1)} aria-label="חודש הבא">
                  <ChevronLeft aria-hidden="true" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="group" aria-label={`ימי ${MONTHS[view.m]} ${view.y}`}>
                {DAYS.map((d) => (
                  <div key={d} aria-hidden="true" className="text-center text-xs font-bold text-stone-600 py-1">{d}</div>
                ))}
                {Array.from({ length: first }, (_, i) => <div key={`e${i}`} aria-hidden="true" />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const date = `${view.y}-${pad2(view.m + 1)}-${pad2(i + 1)}`;
                  const events = byDay.get(date) ?? [];
                  const isToday = date === today;
                  const isSel = date === selected;
                  const label = [
                    `${i + 1} ב${MONTHS[view.m]}`,
                    isToday ? "היום" : "",
                    ...events.map((o) => `${OBLIGATIONS[o.id].title}${filed[o.key] ? ", הוגש" : ""}`),
                  ].filter(Boolean).join(", ");
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-label={label}
                      aria-pressed={isSel}
                      onClick={() => setSelected(date)}
                      className={`min-h-[3.25rem] sm:min-h-[5.5rem] rounded-xl border p-1 sm:p-1.5 text-right align-top flex flex-col transition-colors ${
                        isSel ? "bg-orange-50 border-orange-300" : events.length ? "bg-white border-stone-200 hover:bg-orange-50/50" : "bg-stone-50/50 border-stone-100 hover:bg-stone-50"
                      } ${isToday ? "ring-2 ring-orange-500 ring-offset-1" : ""}`}
                    >
                      <span className={`text-xs sm:text-sm font-bold tabular-nums ${isToday ? "text-orange-700" : "text-stone-700"}`}>{i + 1}</span>
                      {/* Phones: one dot per deadline. Wider screens: a short chip per deadline. */}
                      <span className="flex flex-wrap gap-0.5 mt-auto sm:hidden">
                        {events.map((o) => (
                          <span key={o.key} className="w-2 h-2 rounded-full" style={{ backgroundColor: filed[o.key] ? "#d6d4d0" : TONE[o.authority].dot }} aria-hidden="true" />
                        ))}
                      </span>
                      <span className="hidden sm:flex flex-col gap-0.5 mt-1">
                        {events.map((o) => (
                          <span
                            key={o.key}
                            className={`block truncate rounded-md border px-0.5 text-[11px] leading-4 font-semibold ${filed[o.key] ? "bg-stone-50 text-stone-500 border-stone-200 line-through" : ""}`}
                            style={filed[o.key] ? undefined : toneStyle(o.authority)}
                          >
                            {OBLIGATIONS[o.id].short}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3 mt-3 text-xs text-stone-700">
                {(["vat", "tax", "btl"] as Authority[]).map((a) => (
                  <span key={a} className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TONE[a].dot }} aria-hidden="true" />
                    {AUTHORITY_LABELS[a]}
                  </span>
                ))}
              </div>
            </section>

            {/* ---------- what is due on the selected day ---------- */}
            <aside aria-label="מה מגישים ביום שנבחר" className="rounded-2xl border border-stone-200 bg-white p-4 lg:sticky lg:top-4">
              {selected ? (
                <>
                  <p className="text-sm font-bold text-stone-600">
                    {formatDate(selected)} · {relativeDayLabel(selected, today)}
                  </p>
                  {selectedOcc.length === 0 ? (
                    <p className="mt-3 text-sm text-stone-700 leading-relaxed">אין מועד הגשה ביום הזה. בחרו יום מסומן בלוח.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-stone-200">
                      {selectedOcc.map((o) => (
                        <ObligationDetail
                          key={o.key}
                          occ={o}
                          today={today}
                          filedAt={filed[o.key]}
                          busy={busyKey === o.key}
                          onToggle={(v) => toggleFiled(o.key, v)}
                        />
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-sm text-stone-700">בחרו יום בלוח כדי לראות מה מגישים בו.</p>
              )}
            </aside>
          </div>

          {/* ---------- no fixed date ---------- */}
          <section aria-label="חובות לפי דרישה" className="rounded-2xl border border-stone-200 bg-white p-4">
            <h2 className="font-bold text-stone-900">בלי תאריך קבוע</h2>
            <ul className="mt-2 space-y-3 text-sm text-stone-800 leading-relaxed">
              <li>
                <b>הצהרת הון (טופס 1219):</b> רק כשפקיד השומה שולח דרישה. בדרך כלל יש 120 יום להגיש מיום הדרישה.{" "}
                <a href="https://www.gov.il/he/service/itc1219" target="_blank" rel="noopener" className="font-semibold text-orange-700 underline">לשירות באתר רשות המסים</a>
                {" · "}
                <Link href="/reports/capital-declaration" className="font-semibold text-orange-700 underline">הכנה להצהרת הון באפליקציה</Link>
              </li>
              {type === "company" && (
                <li>
                  <b>הדוחות השנתיים של החברה:</b> דוח שנתי לחברה (טופס 1214) ודוחות כספיים מוגשים בדרך כלל דרך רואה החשבון, ולכן הם לא מופיעים בלוח.
                </li>
              )}
              {filesVat(type) ? null : (
                <li>
                  <b>מעבר לעוסק מורשה:</b> כשהמחזור השנתי עומד לעבור את תקרת עוסק פטור, מבקשים מעבר לפני שמקבלים את התשלום שחוצה אותה. מד התקרה בדף הראשי עוקב אחרי זה.
                </li>
              )}
            </ul>
          </section>

          <p className="text-xs text-stone-600 leading-relaxed">
            מועדי מע״מ, מקדמות וניכויים לשנת 2026 לקוחים מ
            <a href={OFFICIAL_CALENDAR_URL} target="_blank" rel="noopener" className="underline mx-1">לוח המועדים של רשות המסים</a>
            וכוללים את הדחיות בגלל חגים. לתקופות שהלוח עוד לא פורסם עבורן מוצג המועד לפי החוק, ומועד שחל בסוף שבוע עובר ליום שני. זה מידע כללי שמרכז את החובות הנפוצות, ואינו תחליף לייעוץ של רואה חשבון.
          </p>
        </>
      ) : null}
    </div>
  );
}

/** All deadlines on one date, computed directly so a day outside the visible month still works. */
function obligationsOn(date: string, settings: FilingSettings | undefined, type: Parameters<typeof obligationOccurrences>[0]) {
  if (!settings) return [];
  return obligationOccurrences(type, settings, date, date);
}

function DuePill({ date, today }: { date: string; today: string }) {
  const n = daysUntil(date, today);
  const tone = n < 0 ? "bg-stone-100 text-stone-700 border-stone-200" : n <= 7 ? "bg-rose-50 text-rose-800 border-rose-200" : n <= 30 ? "bg-amber-50 text-amber-900 border-amber-200" : "bg-stone-50 text-stone-700 border-stone-200";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${tone}`}>{relativeDayLabel(date, today)}</span>;
}

function ObligationDetail({
  occ,
  today,
  filedAt,
  busy,
  onToggle,
}: {
  occ: ObligationOccurrence;
  today: string;
  filedAt?: string;
  busy: boolean;
  onToggle: (value: boolean) => void;
}) {
  const info = OBLIGATIONS[occ.id];
  const done = Boolean(filedAt);
  return (
    <li className="py-3 first:pt-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className={`font-bold text-stone-900 ${done ? "line-through text-stone-500" : ""}`}>{info.title}</h3>
        <span className="shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold" style={toneStyle(occ.authority)}>{AUTHORITY_LABELS[occ.authority]}</span>
      </div>
      <p className="text-sm text-stone-700">{occ.periodLabel}</p>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        {done ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
            <Check className="w-3.5 h-3.5" aria-hidden="true" /> סומן כהוגש
          </span>
        ) : (
          <DuePill date={occ.date} today={today} />
        )}
        {occ.onlineDate && occ.onlineDate !== occ.date && (
          <span className="text-xs text-stone-700">בדיווח ותשלום באתר: עד {formatDate(occ.onlineDate)}</span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-sm">
        <dt className="font-bold text-stone-600">מי</dt>
        <dd className="text-stone-800">{info.who}</dd>
        <dt className="font-bold text-stone-600">מה</dt>
        <dd className="text-stone-800">{info.what}</dd>
        <dt className="font-bold text-stone-600">מתי</dt>
        <dd className="text-stone-800">{info.when}</dd>
        <dt className="font-bold text-stone-600">איפה</dt>
        <dd>
          <a href={info.whereUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold text-orange-700 underline">
            {info.whereLabel}
            <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          </a>
        </dd>
        <dt className="font-bold text-stone-600">איך</dt>
        <dd className="text-stone-800">{info.how}</dd>
      </dl>
      {!occ.official && ["vat_periodic", "vat_detailed", "income_tax_advance", "withholding"].includes(occ.id) && (
        <p className="mt-2 text-xs text-stone-600">רשות המסים עוד לא פרסמה את לוח המועדים לתקופה הזו. התאריך לפי החוק, ומועד שחל בחג עשוי לזוז.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {info.appHref && (
          <Link href={info.appHref} className="pgbtn pgbtn-primary">{info.appLabel}</Link>
        )}
        <label className="inline-flex items-center gap-2 min-h-[44px] px-2 text-sm font-semibold text-stone-800 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-orange-600" checked={done} disabled={busy} onChange={(e) => onToggle(e.target.checked)} />
          הגשתי
        </label>
      </div>
    </li>
  );
}

function SettingsCard({ settings, vat, onChange }: { settings: FilingSettings; vat: boolean; onChange: (patch: Partial<FilingSettings>) => void }) {
  return (
    <section aria-label="הגדרות חובות הגשה" className="rounded-2xl border border-stone-200 bg-white p-4 space-y-4">
      <p className="text-sm text-stone-700">כך הלוח יודע אילו מועדים להציג. אפשר לשנות בכל רגע.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {vat && (
          <CadenceField label="דוח מע״מ" hint="עסק עם מחזור גבוה מדווח כל חודש. רשות המסים הודיעה לך מה התדירות שלך." value={settings.vatCadence} onChange={(v) => onChange({ vatCadence: v })} />
        )}
        <CadenceField label="מקדמות מס הכנסה" hint="התדירות מופיעה בפנקס המקדמות." value={settings.advanceCadence} onChange={(v) => onChange({ advanceCadence: v })} />
      </div>
      <div className="flex flex-col gap-1">
        {vat && (
          <Toggle label="אני חייב בדיווח מפורט למע״מ (PCN874)" checked={settings.detailedReporter} onChange={(v) => onChange({ detailedReporter: v })} />
        )}
        <Toggle label="יש לי עובדים (דיווח ניכויים חודשי)" checked={settings.hasEmployees} onChange={(v) => onChange({ hasEmployees: v })} />
        <Toggle label="תזכורת לפני כל מועד (התראה באפליקציה)" checked={settings.remindersEnabled} onChange={(v) => onChange({ remindersEnabled: v })} />
      </div>
      {settings.remindersEnabled && (
        <label className="flex flex-wrap items-center gap-2 text-sm text-stone-800">
          כמה ימים לפני:
          <select
            value={settings.reminderDaysBefore}
            onChange={(e) => onChange({ reminderDaysBefore: Number(e.target.value) })}
            className="input-warm py-2 px-3 text-sm min-h-[2.75rem]"
            style={{ width: "auto", minWidth: "7.5rem", maxWidth: "12rem" }}
          >
            {[1, 2, 3, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n === 1 ? "יום אחד" : `${n} ימים`}</option>)}
          </select>
        </label>
      )}
    </section>
  );
}

function CadenceField({ label, hint, value, onChange }: { label: string; hint: string; value: Cadence; onChange: (v: Cadence) => void }) {
  return (
    <div>
      <p className="text-sm font-bold text-stone-900">{label}</p>
      <div className="dash-range rpt-modes mt-1.5" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }} role="group" aria-label={label}>
        {(["bimonthly", "monthly"] as Cadence[]).map((c) => (
          <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(c)} className={`dash-range-btn${value === c ? " is-active" : ""}`}>
            {c === "bimonthly" ? "כל חודשיים" : "כל חודש"}
          </button>
        ))}
      </div>
      <p className="text-xs text-stone-600 mt-1">{hint}</p>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 min-h-[44px] text-sm text-stone-800 cursor-pointer">
      <input type="checkbox" className="w-4 h-4 accent-orange-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

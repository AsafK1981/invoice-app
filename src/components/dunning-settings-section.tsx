"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { useBusiness, saveBusiness } from "@/lib/business-store";

export function DunningSettingsSection() {
  const { business, ready, refetch } = useBusiness();
  const [enabled, setEnabled] = useState(false);
  const [fromName, setFromName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (ready) {
      setEnabled(business.dunningEnabled ?? false);
      setFromName(business.dunningFromName ?? "");
    }
  }, [ready, business.dunningEnabled, business.dunningFromName]);

  async function persist(nextEnabled: boolean, nextFromName: string) {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      await saveBusiness({
        ...business,
        dunningEnabled: nextEnabled,
        dunningFromName: nextFromName.trim() || undefined,
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
            <Bell className="w-4 h-4 text-orange-700" />
          ) : (
            <BellOff className="w-4 h-4 text-stone-500" />
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-stone-900">תזכורות תשלום אוטומטיות</h3>
          <p className="text-sm text-stone-700 mt-1">
            כשתאשרו, המערכת תשלח אוטומטית 3 תזכורות מנומסות ללקוחות עם חוב פתוח: יום 3 (תזכורת רכה) → יום 14 (תזכורת שניה) → יום 30 (דרישת תשלום).
            כל תזכורת נשלחת פעם אחת בלבד למסמך, ומפסיקה אוטומטית כשהחשבונית מסומנת שולמה.
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
              persist(next, fromName);
            }}
            className="w-5 h-5 rounded text-orange-500 focus:ring-orange-500"
          />
          <span className="text-sm font-medium text-stone-900">
            הפעלת שליחת תזכורות אוטומטיות
          </span>
        </label>

        {enabled && (
          <div className="pl-8">
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              שם השולח שיופיע במייל
            </label>
            <div className="flex items-stretch gap-2 flex-wrap">
              <input
                type="text"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder={business.name || "שם העסק"}
                className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-stone-300 bg-white text-sm focus:border-orange-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => persist(enabled, fromName)}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-50"
              >
                {saving ? "שומר..." : "שמור"}
              </button>
            </div>
            <p className="text-xs text-stone-500 mt-1.5">
              אם תשאיר ריק, יוצג שם העסק ({business.name || "לא הוגדר"}).
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

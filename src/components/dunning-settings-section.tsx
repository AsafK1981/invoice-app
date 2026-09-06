"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, AlertCircle, MessageCircle } from "lucide-react";
import { useBusiness, saveBusiness, saveDunningWhatsappEnabled } from "@/lib/business-store";
import { useToast } from "@/components/ui/toast";

interface Draft {
  enabled: boolean;
  fromName: string;
}

export function DunningSettingsSection() {
  const { business, ready, refetch } = useBusiness();
  const showToast = useToast();

  const [draft, setDraft] = useState<Draft>({ enabled: false, fromName: "" });
  const [baseline, setBaseline] = useState<Draft>(draft);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The WhatsApp switch is NOT part of the draft above: it writes its own
  // single column the moment it is flipped (saveDunningWhatsappEnabled), so
  // a stale snapshot of this form can never revert it. Local state only
  // mirrors the saved value for an instant response.
  const [waEnabled, setWaEnabled] = useState(true);
  const [waSaving, setWaSaving] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const loaded: Draft = {
      enabled: business.dunningEnabled ?? false,
      fromName: business.dunningFromName ?? "",
    };
    setDraft(loaded);
    setBaseline(loaded);
  }, [ready, business.dunningEnabled, business.dunningFromName]);

  useEffect(() => {
    if (!ready) return;
    setWaEnabled(business.dunningWhatsappEnabled !== false);
  }, [ready, business.dunningWhatsappEnabled]);

  async function handleWhatsappToggle(on: boolean) {
    if (!business.id) return;
    setErr(null);
    setWaEnabled(on);
    setWaSaving(true);
    try {
      await saveDunningWhatsappEnabled(business.id, on);
      showToast(on ? "תזכורות הוואטסאפ מופעלות" : "תזכורות הוואטסאפ כבויות", "success");
    } catch (e) {
      setWaEnabled(!on);
      const message = e instanceof Error ? e.message : "שגיאה בשמירה";
      setErr(message);
      showToast(message, "error");
    } finally {
      setWaSaving(false);
    }
  }

  const dirty = draft.enabled !== baseline.enabled || draft.fromName !== baseline.fromName;

  async function handleSave() {
    setErr(null);
    setSaving(true);
    try {
      await saveBusiness({
        ...business,
        dunningEnabled: draft.enabled,
        dunningFromName: draft.fromName.trim() || undefined,
      });
      await refetch();
      setBaseline(draft);
      showToast("הגדרות תזכורות התשלום נשמרו", "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : "שגיאה בשמירה";
      setErr(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-soft p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center flex-shrink-0">
          {draft.enabled ? (
            <Bell className="w-4 h-4 text-orange-700" />
          ) : (
            <BellOff className="w-4 h-4 text-stone-500" />
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-stone-900">תזכורות תשלום אוטומטיות</h3>
          <p className="text-sm text-stone-700 mt-1">
            כשתאשרו, המערכת תשלח אוטומטית 3 תזכורות מנומסות ללקוחות עם חוב פתוח: יום 3 (תזכורת רכה) → יום 14 (תזכורת שנייה) → יום 30 (דרישת תשלום).
            כל תזכורת נשלחת פעם אחת בלבד למסמך, ומפסיקה אוטומטית כשהחשבונית מסומנת שולמה.
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
            הפעלת שליחת תזכורות אוטומטיות
          </span>
        </label>

        {draft.enabled && (
          <div className="pl-8">
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              שם השולח שיופיע במייל
            </label>
            <input
              type="text"
              value={draft.fromName}
              onChange={(e) => setDraft((d) => ({ ...d, fromName: e.target.value }))}
              placeholder={business.name || "שם העסק"}
              className="w-full max-w-sm px-3 py-2 rounded-xl border border-stone-300 bg-white text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            <p className="text-xs text-stone-500 mt-1.5">
              אם תשאיר ריק, יוצג שם העסק ({business.name || "לא הוגדר"}).
            </p>
          </div>
        )}
      </div>

      <div className="mt-5 pt-4 border-t border-stone-100">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={waEnabled}
            disabled={waSaving || !business.id}
            onChange={(e) => handleWhatsappToggle(e.target.checked)}
            className="w-5 h-5 mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-medium text-stone-900">
              <MessageCircle className="w-4 h-4 text-emerald-700" />
              תזכורות גבייה בוואטסאפ (אתם שולחים בלחיצה)
            </span>
            <span className="block text-xs text-stone-600 mt-1 leading-relaxed">
              כשחשבונית פתוחה מגיעה ליום 3, 14 או 30 בלי תשלום, תקבלו התראה עם הודעה מוכנה.
              לחיצה פותחת את הוואטסאפ שלכם עם הטקסט, ואתם שולחים מהמספר שלכם. המערכת לא שולחת
              ללקוח כלום בדרך הזו, ולא עולה כסף.
            </span>
            <span className="block text-xs text-stone-500 mt-1">
              {waSaving ? "שומר..." : "נשמר מיד, בלי כפתור שמירה"}
            </span>
          </span>
        </label>
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

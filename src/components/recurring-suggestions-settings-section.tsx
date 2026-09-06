"use client";

import { useEffect, useState } from "react";
import { Repeat, AlertCircle } from "lucide-react";
import { useBusiness, saveBusiness } from "@/lib/business-store";
import { useToast } from "@/components/ui/toast";

/**
 * The off switch for the detected-cadence proposals
 * (/api/cron/recurring-proposals). Lives next to the other reminder settings
 * because it is the same promise: the app may speak to you on a schedule, and
 * you decide whether it does.
 *
 * Same save shape as its neighbours on /reminders (draft + baseline + an
 * explicit שמירה), so the page behaves consistently.
 */
export function RecurringSuggestionsSettingsSection() {
  const { business, ready, refetch } = useBusiness();
  const showToast = useToast();

  const [enabled, setEnabled] = useState(true);
  const [baseline, setBaseline] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const loaded = business.recurringSuggestionsEnabled !== false;
    setEnabled(loaded);
    setBaseline(loaded);
  }, [ready, business.recurringSuggestionsEnabled]);

  const dirty = enabled !== baseline;

  async function handleSave() {
    setErr(null);
    setSaving(true);
    try {
      await saveBusiness({ ...business, recurringSuggestionsEnabled: enabled });
      await refetch();
      setBaseline(enabled);
      showToast("ההגדרה נשמרה", "success");
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
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center flex-shrink-0">
          <Repeat className={`w-4 h-4 ${enabled ? "text-violet-700" : "text-stone-500"}`} />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-stone-900">הצעות חכמות למסמכים חוזרים</h3>
          <p className="text-sm text-stone-700 mt-1">
            אם אתם מוציאים לאותו לקוח את אותו מסמך כל חודש, בערך באותו יום, נכין אותו מראש בדשבורד עם התאריך והחודש מעודכנים. שום דבר לא מופק בלי שתאשרו.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-5 h-5 rounded text-orange-500 focus:ring-orange-500"
        />
        <span className="text-sm font-medium text-stone-900">
          להציע לי מסמכים חוזרים
        </span>
      </label>

      <p className="text-xs text-stone-500 mt-3">
        נציע רק אחרי שלושה מסמכים דומים לפחות, במרווחים של בערך חודש. אפשר גם לבטל הצעה בודדת מהכרטיס עצמו.
      </p>

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

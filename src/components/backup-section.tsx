"use client";

import { useEffect, useState } from "react";
import { HardDriveDownload, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/lib/business-store";
import { friendlyError } from "@/lib/error-message";
import { formatDate } from "@/lib/format";

/**
 * הוראות ניהול ספרים סעיף 25(ו): the taxpayer backs up the computerized
 * documents and the books in the first week of every quarter and keeps the
 * backup at a separate place in Israel. The app cannot keep it for them (that
 * would be the same place); it can hand them the complete archive in one
 * click, remember when they last took one, and nag at the start of each
 * quarter (api/cron/backup-reminder).
 */
export function BackupSection() {
  const { business, ready } = useBusiness();
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!business.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("created_at")
        .eq("business_id", business.id)
        .eq("action", "business.backup_exported")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setLastAt((data?.created_at as string) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [business.id, busy]);

  if (!ready || !business.id) return null;

  const quarterStart = (() => {
    const n = new Date();
    return new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1);
  })();
  const coveredThisQuarter = Boolean(lastAt && new Date(lastAt) >= quarterStart);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("פג תוקף ההתחברות, התחבר מחדש");
      const res = await fetch("/api/backup", { headers: { authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(friendlyError(body, "הגיבוי נכשל. נסו שוב."));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "הגיבוי נכשל");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="backup" className="card-soft p-5 scroll-mt-6">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-2xl bg-stone-100 flex items-center justify-center shrink-0">
          <HardDriveDownload className="w-4 h-4 text-stone-500" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-stone-900">גיבוי רבעוני</h2>
          <p className="text-sm text-stone-700 mt-1 leading-relaxed">
            הוראות ניהול ספרים (סעיף 25(ו)) מחייבות גיבוי של המסמכים הממוחשבים ושל
            מערכת החשבונות בשבוע הראשון של כל רבעון, שנשמר במקום נפרד בישראל: דיסק
            חיצוני, כונן ענן, או אצל רואה החשבון. הקובץ כולל את כל הנתונים ואת כל
            המסמכים החתומים. שמרו כל גיבוי שבע שנים.
          </p>

          <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <button
              type="button"
              onClick={() => void download()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-orange-700 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:shadow-md disabled:opacity-50"
            >
              <HardDriveDownload className="w-4 h-4" />
              {busy ? "מכין את הגיבוי..." : "הורד גיבוי מלא"}
            </button>
            {lastAt ? (
              <span className={`inline-flex items-center gap-1.5 text-xs ${coveredThisQuarter ? "text-emerald-800" : "text-stone-500"}`}>
                {coveredThisQuarter && <CheckCircle2 className="w-3.5 h-3.5" />}
                גיבוי אחרון: {formatDate(lastAt.slice(0, 10))}
                {coveredThisQuarter ? " (הרבעון הנוכחי מכוסה)" : ""}
              </span>
            ) : (
              <span className="text-xs text-stone-500">עדיין לא הורד גיבוי.</span>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
        </div>
      </div>
    </section>
  );
}

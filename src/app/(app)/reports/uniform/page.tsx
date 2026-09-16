"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileArchive } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { StoreLoadError } from "@/components/store-load-error";
import { useBusiness } from "@/lib/business-store";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/error-message";
import { FilingFixPanel } from "@/components/filing-fix-panel";
import { buildUniformFixModel } from "@/lib/uniform-fix-items";
import { uniformCanDownload, type UniformIssue } from "@/lib/uniform-structure/issues";
import { UniformStructureReport, parseUniformReport, type UniformReportData } from "@/components/uniform-structure-report";
import { BUSINESS_TYPE_LABELS } from "@/lib/types";

/**
 * מבנה אחיד (OPENFORMAT 1.31) - its own report page.
 *
 * It used to be the one card on /reports that was a button instead of a link:
 * clicking it left the user where he stood, ran a ~6-second server check, and
 * then injected a result panel at the TOP of the page. Asaf read that as "I
 * clicked a report and it threw me back to the reports screen with no
 * explanation" (2026-09-16) - and he was right, that is exactly what it looked
 * like. Every report on this app opens its own page; this one now does too, and
 * it says in writing who needs the file and who does not, instead of leaving
 * the user to guess.
 */
export default function UniformStructurePage() {
  const { documents, ready, error, retry } = useDocuments();
  const { business } = useBusiness();
  // ?sample=1 - the synthetic dataset for רשות המסים's registry simulator.
  // Reached from the export menu on /reports, never a normal user's path. Read
  // on mount rather than with useSearchParams, which would force a Suspense
  // boundary around the whole page (same convention as /reports/periodic).
  const [sample, setSample] = useState(false);
  useEffect(() => {
    setSample(new URLSearchParams(window.location.search).get("sample") === "1");
  }, []);

  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ year: number; issues: UniformIssue[] } | null>(null);
  const [report, setReport] = useState<UniformReportData | null>(null);
  const model = useMemo(() => (check ? buildUniformFixModel(check.issues) : null), [check]);

  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()]);
    for (const d of documents) {
      const y = Number(d.date?.slice(0, 4));
      if (Number.isFinite(y) && y > 1990) set.add(y);
    }
    return [...set].sort((a, b) => b - a);
  }, [documents]);

  /**
   * `recheck`: run the check again after an inline fix and keep the panel on
   * screen until the new result lands, instead of clearing it first.
   */
  async function run(download = false, recheck = false) {
    if (busy) return;
    setBusy(true);
    const checkedYear = year;
    if (!download && !recheck) setCheck(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("פג תוקף ההתחברות, התחבר מחדש");
      const qs = `year=${checkedYear}${sample ? "&sample=true" : ""}${download ? "" : "&preflight=true"}`;
      const res = await fetch(`/api/uniform-structure/export?${qs}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok || !download) {
        const result = await res.json();
        if (res.status === 429) {
          setCheck({ year: checkedYear, issues: [{ code: "rate_limited", level: "error", message: friendlyError(result, "יותר מדי בדיקות ברצף. המתן כמה דקות ונסה שוב.") }] });
          return;
        }
        if (Array.isArray(result.issues)) {
          const issues: UniformIssue[] = result.issues;
          if (!res.ok && !issues.some((issue) => issue.level === "error")) issues.push({ code: "data_load_failed", level: "error", message: friendlyError(result, "הבדיקה נכשלה. נסו שוב.") });
          setCheck({ year: checkedYear, issues });
        } else throw new Error(friendlyError(result, "בדיקת הקובץ נכשלה. נסו שוב."));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `OPENFRMT-${business.taxId}-${checkedYear}${sample ? "-SAMPLE" : ""}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setReport(parseUniformReport(res.headers.get("X-Uniform-Report")));
    } catch (err) {
      const message = err instanceof Error ? err.message : "הבדיקה נכשלה. נסו שוב.";
      setCheck({ year: checkedYear, issues: [{ code: "data_load_failed", level: "error", message }] });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <StoreLoadError sources={[{ error, retry }]} />;
  if (!ready) return <div className="text-center py-16 text-stone-500">טוען...</div>;

  return (
    <div className="space-y-6" data-print-hidden={report ? "true" : undefined}>
      <div className="no-print">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium">
          <ArrowRight className="w-4 h-4" />
          חזרה לדוחות
        </Link>
      </div>

      <div className="flex items-end justify-between flex-wrap gap-4">
        <div className="min-w-0 max-w-full">
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 shrink-0 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
              <FileArchive className="w-5 h-5 text-white" />
            </span>
            <span className="min-w-0 break-words" data-report-title="מבנה אחיד">
              מבנה אחיד (Open Format)
            </span>
          </h1>
          <p className="text-sm text-stone-600 mt-2 mr-14">
            קובץ התקן של רשות המסים עם כל המסמכים והתנועות של השנה. מפיקים אותו כשמבקשים ממך בביקורת, כשרואה החשבון רוצה לייבא הכל, או כשעוברים לתוכנה אחרת. זה לא דיווח תקופתי.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-stone-700 no-print whitespace-nowrap">
          שנת מס:
          <select
            value={year}
            onChange={(e) => { setYear(Number(e.target.value)); setCheck(null); setReport(null); }}
            className="input-warm py-2 px-3 text-sm w-auto"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {/* The answer to "why can I not just open this report?" - it is not a
          screen with numbers, it is a file you produce on demand. */}
      <div className="card-soft p-5 space-y-3 no-print">
        <h2 className="text-lg font-bold text-stone-900">למי הקובץ הזה נועד</h2>
        <ul className="text-sm text-stone-700 leading-relaxed space-y-2 list-disc pr-5">
          <li>
            הקובץ נדרש מכל עסק שמנהל את ספריו בתוכנה - <strong>גם {BUSINESS_TYPE_LABELS.exempt}</strong>.
            סוג העסק לא משנה כאן.
          </li>
          <li>
            לא מגישים אותו ביוזמתך ולא בתאריך קבוע. מפיקים אותו כשמבקר מרשות המסים מבקש
            את נתוני הספרים, או כשרואה החשבון רוצה לייבא את כל השנה במכה אחת.
          </li>
          <li>
            זה <strong>לא</strong> דוח מע״מ תקופתי ולא הצהרה שנתית. את אלה תמצאו
            ב<Link href="/reports/vat" className="text-orange-600 hover:text-orange-700 font-medium">דוח מע״מ</Link>{" "}
            וב<Link href="/reports/periodic" className="text-orange-600 hover:text-orange-700 font-medium">דוח התקופתי</Link>.
          </li>
          <li>
            מה שיורד הוא קובץ ZIP (INI.TXT ו-BKMVDATA.TXT), לא מסך שאפשר לקרוא. לכן
            הכפתור כאן הוא &quot;בדוק והורד&quot; ולא &quot;פתח&quot;.
          </li>
        </ul>
        {sample && (
          <p className="text-sm text-stone-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
            מצב קובץ דוגמה: הנתונים מלאכותיים, לבדיקת תוכנה בלבד. אין להגיש את הקובץ הזה כדיווח של העסק.
          </p>
        )}
        {/* Once the check panel is open it owns the actions (הורד / בדוק שוב),
            so this entry button steps aside instead of sitting there twice. */}
        {!busy && !check && (
          <div className="flex flex-wrap gap-3 pt-1">
            <button type="button" className="pgbtn pgbtn-primary" onClick={() => run(false)}>
              בדוק והורד את הקובץ לשנת {year}
            </button>
          </div>
        )}
      </div>

      {(busy || check?.year === year) && (
        <div id="uniform-preflight" className="card-soft p-4 space-y-3 no-print">
          <h2 className="text-lg font-bold">בדיקה לפני הורדת מבנה אחיד לשנת {year}</h2>
          {busy && <p className="text-sm text-stone-600">טוען את כל הנתונים ובודק את הקובץ...</p>}
          {check && model && <>
            <p className="text-sm text-stone-600 leading-relaxed">
              הבדיקה המקומית אינה אישור קליטה או אישור רישום תוכנה של רשות המסים.
            </p>
            <FilingFixPanel
              model={model}
              businessId={business.id}
              returnTo={sample ? "/reports/uniform?sample=1" : "/reports/uniform"}
              onSaved={() => run(false, true)}
            />
            <div className="flex flex-wrap gap-3">
              <button type="button" data-testid="uniform-download" className="pgbtn pgbtn-primary disabled:opacity-50" disabled={busy || !uniformCanDownload(check.issues)} onClick={() => run(true)}>הורד קובץ לאחר בדיקה</button>
              <button type="button" className="pgbtn pgbtn-quiet disabled:opacity-50" disabled={busy} onClick={() => run(false, true)}>בדוק שוב</button>
            </div>
          </>}
        </div>
      )}

      <UniformStructureReport
        report={report}
        onClose={() => setReport(null)}
        businessName={business.name}
        taxId={business.taxId}
      />
    </div>
  );
}

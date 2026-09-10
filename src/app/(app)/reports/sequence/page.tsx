"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ListOrdered, Printer, CheckCircle2, AlertTriangle } from "lucide-react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { useDocuments } from "@/lib/document-store";
import { useBusiness } from "@/lib/business-store";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";
import { buildSequenceRows, totalMissing } from "@/lib/sequence-check";

/**
 * בדיקת רצף מספור - the numbering-continuity report.
 *
 * The law behind it, and why the year boundary is checked separately, live
 * with the logic in src/lib/sequence-check.ts. This page is the presentation:
 * one row per document type, and the missing numbers spelled out.
 *
 * Since 2026-09-08 a numbered document can no longer be deleted (app + DB
 * trigger, see 20260908-documents-no-delete-once-numbered.sql), so this report
 * is expected to read "אין מספרים חסרים" forever. Showing that, in writing, is
 * the point of it.
 */

export default function SequenceReportPage() {
  const { documents, ready } = useDocuments();
  const { business } = useBusiness();
  const [year, setYear] = useState<number>(() => new Date().getFullYear());

  // Every year the business actually has documents in, newest first, with the
  // current year always offered even before the first document of it exists.
  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()]);
    for (const d of documents) {
      const y = Number(d.date?.slice(0, 4));
      if (Number.isFinite(y) && y > 1990) set.add(y);
    }
    return [...set].sort((a, b) => b - a);
  }, [documents]);

  const rows = useMemo(() => buildSequenceRows(documents, year), [documents, year]);
  const missingCount = totalMissing(rows);
  const periodLabel = `שנת המס ${year}`;

  if (!ready) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  return (
    <div className="space-y-6" data-report-period={periodLabel}>
      <div className="no-print">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לדוחות
        </Link>
      </div>

      <div className="flex items-end justify-between flex-wrap gap-4">
        <div className="min-w-0 max-w-full">
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 shrink-0 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
              <ListOrdered className="w-5 h-5 text-white" />
            </span>
            <span className="min-w-0 break-words" data-report-title="בדיקת רצף מספור">
              בדיקת רצף מספור
            </span>
          </h1>
          <p className="text-sm text-stone-600 mt-2 mr-14">
            לכל סוג מסמך: המספר הראשון, המספר האחרון, הכמות, ורשימה מפורשת של המספרים החסרים
            בטווח. נדרש לפי הוראות ניהול ספרים, נספח ה&apos; (א)(5).
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <DownloadPdfButton
            filename={`בדיקת-רצף-מספור-${year}`}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
            iconClassName="w-4 h-4 text-orange-600"
          />
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
          >
            <Printer className="w-4 h-4 text-orange-600" />
            הדפסה
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="card-soft p-4 no-print">
        <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
          שנת מס:
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="input-warm py-2 px-3 text-sm w-auto"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* The verdict, in one line, because it is the whole answer. */}
      <div
        className={`card-soft p-4 flex items-start gap-3 ${
          missingCount === 0 ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"
        }`}
      >
        {missingCount === 0 ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        )}
        <div className="min-w-0">
          <p className="font-bold text-stone-900">
            {business.name} · {periodLabel}
          </p>
          <p className="text-sm text-stone-700 mt-1">
            {missingCount === 0
              ? "אין מספרים חסרים בכל סוגי המסמכים בשנה זו."
              : `נמצאו ${missingCount} מספרים חסרים. הפירוט בטבלה שלהלן.`}
          </p>
        </div>
      </div>

      {/* Report */}
      <div className="card-soft overflow-hidden">
        <div className="px-5 py-3.5 border-b border-stone-100 flex items-baseline justify-between">
          <h2 className="font-bold text-stone-900 text-lg">{periodLabel}</h2>
          <span className="text-sm text-stone-500">{rows.length} סוגי מסמכים</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            לא הופקו מסמכים בשנה שנבחרה.
          </div>
        ) : (
          <div className="p-5 overflow-x-auto">
            <table className="gk-rtable w-full text-sm border-separate border-spacing-0 rounded-xl overflow-hidden shadow-sm">
              <thead>
                <tr className="bg-gradient-to-l from-orange-500 to-orange-700 text-white">
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">סוג מסמך</th>
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">מספר ראשון</th>
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">מספר אחרון</th>
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">כמות</th>
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center">מספרים חסרים</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.type} className={`${i % 2 ? "bg-orange-50/40" : "bg-white"}`}>
                    <td className="px-4 py-3.5 text-center align-middle whitespace-nowrap font-bold text-stone-900 border-b border-l border-stone-200">
                      {DOCUMENT_TYPE_LABELS[r.type]}
                    </td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{r.first}</td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{r.last}</td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{r.count}</td>
                    <td className="px-4 py-3.5 text-center align-middle border-b border-stone-200">
                      {r.missing.length === 0 ? (
                        <span className="font-semibold text-emerald-700">אין מספרים חסרים</span>
                      ) : (
                        <span className="font-bold text-rose-700 tabular-nums" dir="ltr">
                          {r.missing.join(", ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* The year-boundary check, spelled out per type so the reader can
                see WHY a number outside this year's range is listed missing. */}
            <div className="mt-4 space-y-1 text-xs text-stone-600">
              {rows.map((r) => (
                <p key={r.type}>
                  {DOCUMENT_TYPE_LABELS[r.type]}:{" "}
                  {r.previousYearLast === null
                    ? `אין מסמכים מסוג זה לפני שנת ${year}, הרצף נבדק מהמספר ${r.first}.`
                    : `המספר האחרון לפני שנת ${year} היה ${r.previousYearLast}, והמספר הראשון בשנה הוא ${r.first}.`}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

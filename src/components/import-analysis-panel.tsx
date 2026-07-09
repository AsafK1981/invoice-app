import { ClipboardCheck, AlertTriangle } from "lucide-react";
import type { AnalyzeResult } from "@/lib/import-analyze";
import type { CanonicalField } from "@/lib/import-headers";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format";

/**
 * Read-only, auto-computed pre-import preview for the documents entity. Pure
 * presentational — it just renders an `AnalyzeResult` (from analyzeRows). The
 * three import surfaces (per-entity modal, bulk zone, admin concierge) each
 * compute an AnalyzeResult and drop this component in; the copy + styling live
 * here once so the preview can't triplicate or drift.
 */

/** Canonical field → Hebrew display label, for the "columns not detected" notice. */
const FIELD_LABELS: Record<CanonicalField, string> = {
  number: "מספר",
  type: "סוג",
  client: "לקוח",
  date: "תאריך",
  total: "סכום",
  vat: 'מע"מ',
  status: "סטטוס",
  description: "תיאור",
};

export function ImportAnalysisPanel({ analysis }: { analysis: AnalyzeResult }) {
  const { total, willImport, willSkip, unmappedTypeSamples, unmatchedColumns, sampleMapped } =
    analysis;
  const skipTotal = willSkip.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      {/* Headline counts */}
      <div className="flex items-start gap-2">
        <ClipboardCheck className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
        <p className="text-sm font-semibold text-stone-800">
          נקראו {total} שורות · {willImport} ייובאו
          {skipTotal > 0 && <span className="text-amber-700"> · {skipTotal} ידולגו</span>}
        </p>
      </div>

      {/* Per-reason skip breakdown */}
      {willSkip.length > 0 && (
        <div className="space-y-0.5">
          {willSkip.map((s) => (
            <p key={s.reason} className="text-[11px] text-amber-700">
              {s.count} {s.label}
            </p>
          ))}
        </div>
      )}

      {/* Unrecognized-type notice */}
      {unmappedTypeSamples.length > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <p>
            שורות עם סוג לא מזוהה ייובאו כקבלה
            {" — "}
            <span className="text-amber-600">{unmappedTypeSamples.slice(0, 5).join(" · ")}</span>
          </p>
        </div>
      )}

      {/* Columns-not-detected notice */}
      {unmatchedColumns.length > 0 && (
        <p className="text-[11px] text-stone-500">
          עמודות שלא זוהו: {unmatchedColumns.map((f) => FIELD_LABELS[f]).join(" · ")}
        </p>
      )}

      {/* Sample mapping table */}
      {sampleMapped.length > 0 && (
        <div className="max-h-48 overflow-auto rounded-lg border border-amber-100 bg-white">
          <table className="w-full text-[11px]">
            <thead className="bg-amber-50/70 sticky top-0">
              <tr>
                <th className="text-right px-2 py-1.5 font-semibold text-stone-600">מספר</th>
                <th className="text-right px-2 py-1.5 font-semibold text-stone-600">סוג</th>
                <th className="text-right px-2 py-1.5 font-semibold text-stone-600">תאריך</th>
                <th className="text-right px-2 py-1.5 font-semibold text-stone-600">סכום</th>
                <th className="text-right px-2 py-1.5 font-semibold text-stone-600">לקוח</th>
              </tr>
            </thead>
            <tbody>
              {sampleMapped.map((r, idx) => (
                <tr key={idx} className="border-t border-amber-50">
                  <td className="px-2 py-1 text-stone-700">{r.number || "—"}</td>
                  <td className="px-2 py-1 text-stone-700">{DOCUMENT_TYPE_LABELS[r.type]}</td>
                  <td className="px-2 py-1 text-stone-700">{r.date ? formatDate(r.date) : "—"}</td>
                  <td className="px-2 py-1 text-stone-700">
                    {r.total == null ? "—" : formatCurrency(r.total)}
                  </td>
                  <td className="px-2 py-1 text-stone-700 truncate max-w-[120px]">
                    {r.client || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

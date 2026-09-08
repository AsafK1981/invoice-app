"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, Printer, TrendingUp } from "lucide-react";
import { ReportPageHeader } from "@/components/report-page-header";
import { PeriodPicker } from "@/components/period-picker";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { useToast } from "@/components/ui/toast";
import { useBusiness } from "@/lib/business-store";
import { useProfitLossData } from "@/lib/profit-loss-data";
import { calculateProfitLoss, RESULT_LABEL } from "@/lib/profit-loss";
import { periodLabel, type Period } from "@/lib/report-period";
import { downloadXlsx, sheet } from "@/lib/xlsx-export";
import { todayInIsrael } from "@/lib/date";
import { formatCurrency, formatDate } from "@/lib/format";

const money = (cents: number) => formatCurrency(cents / 100);

export default function ProfitLossPage() {
  const { business, ready } = useBusiness();
  const { data, error, retry } = useProfitLossData(ready ? business.id : "");
  const [period, setPeriod] = useState<Period>(() => todayInIsrael().slice(0, 4));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const report = useMemo(() => data ? calculateProfitLoss(data.documents, data.expenses, business.businessType, period) : null, [data, business.businessType, period]);
  const filename = `profit-loss-${period.replace("..", "_")}`;
  const detailRows = report ? [
    { label: "הכנסות לפני זיכויים", amount: report.income },
    { label: "זיכויים", amount: report.credits },
    { label: "הכנסות לאחר זיכויים", amount: report.netIncome, strong: true },
    ...report.categories.map((c) => ({ label: `הוצאות: ${c.category}`, amount: c.amount })),
    { label: "סה״כ הוצאות שוטפות", amount: report.operatingExpenses, strong: true },
    { label: RESULT_LABEL, amount: report.result, strong: true },
  ] : [];
  async function exportExcel() {
    if (!report || busy) return;
    setBusy(true);
    try {
      await downloadXlsx(`${filename}.xlsx`, [sheet({
        name: "רווח והפסד", title: "דוח רווח והפסד", businessName: `${business.name} | מספר עסק: ${business.taxId}`, subtitle: periodLabel(period), notes: report.notes,
        columns: [{ header: "סעיף", value: (row: { label: string; amount: number }) => row.label, width: 54 }, { header: "סכום בש״ח", value: (row) => row.amount / 100, kind: "money", width: 22 }],
        rows: [...detailRows, { label: "רכישות ציוד (בנפרד, לא הופחתו מהרווח)", amount: report.equipment }],
      })]);
    } catch { toast("יצירת קובץ Excel נכשלה. נסו שוב."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6" dir="rtl">
    <div className="no-print"><ReportPageHeader icon={TrendingUp} title="דוח רווח והפסד" subtitle="ההכנסות, ההוצאות ומה שנשאר בעסק - במקום אחד." /></div>
    <div className="rpt-controls no-print"><PeriodPicker period={period} onChange={setPeriod} /></div>
    {!ready ? <p role="status" className="py-16 text-center text-stone-600">טוען את פרטי העסק...</p>
      : !business.id ? <p role="alert" className="p-6 rounded-2xl bg-amber-50 text-amber-900">לא ניתן לטעון את פרטי העסק. יש לרענן את העמוד ולנסות שוב.</p>
      : error ? <div role="alert" className="p-6 rounded-2xl bg-amber-50 text-amber-900"><p>{error}</p><button type="button" className="pgbtn pgbtn-quiet mt-3" onClick={retry}>ניסיון נוסף</button></div>
      : !report ? <p role="status" className="py-16 text-center text-stone-600">טוען את כל נתוני הדוח...</p>
      : <>
        <div className="flex flex-wrap gap-2 no-print">
          <DownloadPdfButton filename={`${filename}.pdf`} />
          <button type="button" className="pgbtn pgbtn-quiet" onClick={() => window.print()}><Printer aria-hidden="true" />הדפסה</button>
          <button type="button" className="pgbtn pgbtn-quiet" onClick={exportExcel} disabled={busy} aria-busy={busy}><FileSpreadsheet aria-hidden="true" />{busy ? "מכין Excel..." : "ייצוא ל-Excel"}</button>
        </div>
        <article className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-8 space-y-6 print:border-0 print:p-0 print:space-y-4">
          <header className="border-b border-stone-200 pb-5">
            <p className="font-semibold text-stone-700 break-words">{business.name}</p>
            <p className="text-sm text-stone-600 mt-1">מספר עסק: {business.taxId}</p>
            <h2 className="text-2xl font-bold text-stone-900 mt-4">דוח רווח והפסד</h2>
            <p className="text-stone-600 mt-1">{periodLabel(period)} · סכומים בש״ח</p>
            <p className="text-sm text-stone-600 mt-1">הופק ב-{formatDate(todayInIsrael())}</p>
          </header>
          {report.excluded > 0 && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900 font-medium">דוח חלקי: {report.excluded} רשומות לא נכללו. פירוט בהערות הדוח.</p>}
          {!report.records && !report.excluded && <p className="rounded-xl bg-stone-50 p-4 text-stone-700">אין הכנסות או הוצאות בתקופה שבחרת. אפשר לבחור תקופה אחרת.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:hidden">
            {[{ label: "הכנסות לאחר זיכויים", value: report.netIncome }, { label: "הוצאות שוטפות", value: report.operatingExpenses }, { label: RESULT_LABEL, value: report.result }].map((item, i) => <div key={item.label} className={`rounded-xl p-4 ${i === 2 ? "bg-emerald-50 border border-emerald-200" : "bg-stone-50"}`}><p className="text-sm text-stone-700">{item.label}</p><p dir="ltr" className={`mt-2 text-2xl font-bold text-right tabular-nums ${item.value < 0 ? "text-red-700" : "text-stone-900"}`}>{money(item.value)}</p></div>)}
          </div>
          <section aria-label="פירוט הכנסות והוצאות">
            <h3 className="font-bold text-lg mb-3">פירוט הדוח</h3>
            <dl className="divide-y divide-stone-100">
              {detailRows.map((row, index) => <div key={index} className={`flex justify-between items-start gap-4 py-3 print:py-2 break-inside-avoid ${row.strong ? "font-bold" : ""}`}><dt className="min-w-0 break-words">{row.label}</dt><dd dir="ltr" className="shrink-0 tabular-nums">{money(row.amount)}</dd></div>)}
            </dl>
          </section>
          <div className="rounded-xl bg-stone-50 p-4"><div className="flex justify-between gap-4"><h3 className="font-semibold">רכישות ציוד</h3><p dir="ltr" className="shrink-0 tabular-nums font-semibold">{money(report.equipment)}</p></div><p className="text-sm text-stone-600 mt-2">מוצגות בנפרד. לא הופחתו מהרווח; הפחת יחושב במסגרת ההתאמות לדיווח.</p></div>
          <section className="border-t border-stone-200 pt-5 break-inside-avoid"><h3 className="font-semibold mb-3">איך הדוח מחושב?</h3><ul className="list-disc pr-5 space-y-2 text-sm leading-relaxed text-stone-600">{report.notes.map((note) => <li key={note}>{note}</li>)}</ul></section>
        </article>
      </>}
  </div>;
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Printer, TrendingDown, AlertTriangle } from "lucide-react";
import { ReportPageHeader } from "@/components/report-page-header";
import { PeriodPicker } from "@/components/period-picker";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { useToast } from "@/components/ui/toast";
import { useBusiness } from "@/lib/business-store";
import { useFilingReportData } from "@/lib/filing-report-data";
import { buildExpenseReport, expenseCategories, type ExpenseKind, type ExpenseReportRow, type ExpenseCategoryTotal } from "@/lib/expense-report";
import { periodLabel, type Period } from "@/lib/report-period";
import { downloadXlsx, sheet, type XlsxColumn } from "@/lib/xlsx-export";
import { todayInIsrael } from "@/lib/date";
import { formatCurrency, formatDate } from "@/lib/format";

/** Which amounts the table shows. עוסק פטור never sees this switch. */
type VatView = "full" | "gross" | "net";

const VAT_VIEWS: { id: VatView; label: string }[] = [
  { id: "full", label: "פירוט" },
  { id: "gross", label: "כולל מע״מ" },
  { id: "net", label: "לפני מע״מ" },
];

/** Three options, not the period picker's six: overrides the phone grid in app-skin.css. */
const THREE_UP = { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" };

const KINDS: { id: ExpenseKind; label: string }[] = [
  { id: "all", label: "הכל" },
  { id: "running", label: "שוטפות" },
  { id: "equipment", label: "ציוד" },
];

export default function ExpensesReportPage() {
  const { business, ready } = useBusiness();
  const { data, error, retry } = useFilingReportData(ready ? business.id : "", true);
  const toast = useToast();
  const [period, setPeriod] = useState<Period>(() => todayInIsrael().slice(0, 4));
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<ExpenseKind>("all");
  const [vatView, setVatView] = useState<VatView>("full");
  const [busy, setBusy] = useState(false);

  const expenses = useMemo(() => data?.expenses ?? [], [data]);
  const categories = useMemo(() => expenseCategories(expenses), [expenses]);
  const report = useMemo(() => buildExpenseReport(expenses, { period, category, kind }), [expenses, period, category, kind]);

  // Same rule as the expenses Excel: VAT columns for a VAT filer, or when the
  // data carries VAT anyway.
  const filesVat = business.businessType === "authorized" || business.businessType === "company";
  const hasVat = filesVat || expenses.some((e) => (e.vatAmount ?? 0) > 0);
  const view: VatView = hasVat ? vatView : "gross";
  const showNet = view !== "gross";
  const showVatCol = view === "full";
  const showGross = view !== "net";
  // Supplier identifiers only matter to a VAT filer; hide a column nobody filled in.
  const showTaxId = hasVat && report.rows.some((r) => r.supplierTaxId);
  const showRef = hasVat && report.rows.some((r) => r.reference);
  const showAlloc = hasVat && report.rows.some((r) => r.allocationNumber);

  const label = periodLabel(period);
  const scopeLabel = [label, category || null, kind === "all" ? null : KINDS.find((k) => k.id === kind)?.label].filter(Boolean).join(" · ");
  const filename = `expenses-report-${period.replace("..", "_")}`;

  async function exportExcel() {
    if (busy || report.rows.length === 0) return;
    setBusy(true);
    try {
      const money = (header: string, pick: (r: { net: number; vat: number; gross: number }) => number) =>
        ({ header, value: pick, kind: "money" as const, total: "sum" as const });
      const amountCols = <T extends { net: number; vat: number; gross: number }>(): XlsxColumn<T>[] => [
        ...(showNet ? [money("סכום לפני מע״מ", (r) => r.net)] : []),
        ...(showVatCol ? [money("מע״מ", (r) => r.vat)] : []),
        ...(showGross ? [money(hasVat ? "סכום כולל מע״מ" : "סכום", (r) => r.gross)] : []),
      ];
      const meta = { businessName: `${business.name} | מספר עסק: ${business.taxId}`, subtitle: scopeLabel };
      await downloadXlsx(`${filename}.xlsx`, [
        sheet<ExpenseReportRow>({
          ...meta,
          name: "הוצאות",
          title: "דוח הוצאות",
          countLabel: `${report.rows.length} הוצאות`,
          rows: report.rows,
          columns: [
            { header: "תאריך", value: (r) => r.date, kind: "date" },
            { header: "ספק", value: (r) => r.supplier },
            ...(hasVat ? [
              { header: "מספר עוסק ספק", value: (r: ExpenseReportRow) => r.supplierTaxId },
              { header: "מספר חשבונית", value: (r: ExpenseReportRow) => r.reference },
            ] : []),
            { header: "קטגוריה", value: (r) => r.category },
            { header: "תיאור", value: (r) => r.description, width: 30 },
            { header: "סוג", value: (r) => (r.isEquipment ? "ציוד" : "שוטפת") },
            ...amountCols<ExpenseReportRow>(),
            ...(hasVat ? [{ header: "מספר הקצאה", value: (r: ExpenseReportRow) => r.allocationNumber }] : []),
          ],
          notes: filesVat && report.gapCount > 0 ? [`${report.gapCount} הוצאות חסרות פרטים שנדרשים כדי שמע״מ יכיר בתשומה.`] : undefined,
        }),
        sheet<ExpenseCategoryTotal>({
          ...meta,
          name: "לפי קטגוריה",
          title: "הוצאות לפי קטגוריה",
          rows: report.categories,
          columns: [
            { header: "קטגוריה", value: (r) => r.category },
            { header: "מספר הוצאות", value: (r) => r.count, kind: "int", total: "sum" },
            ...amountCols<ExpenseCategoryTotal>(),
          ],
        }),
      ]);
    } catch {
      toast("יצירת קובץ Excel נכשלה. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="no-print">
        <ReportPageHeader
          icon={TrendingDown}
          title="דוח הוצאות"
          subtitle="כל ההוצאות בתקופה שבחרת, עם סכום לפני מע״מ, מע״מ תשומות וסכום כולל - לרואה החשבון, למס הכנסה ולמע״מ."
          period={scopeLabel}
        />
      </div>

      <div className="rpt-controls no-print">
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>

      <div className="flex flex-wrap items-center gap-3 no-print">
        <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
          קטגוריה
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-warm py-2 px-3 text-sm w-auto min-h-[2.75rem]">
            <option value="">כל הקטגוריות</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="dash-range rpt-modes" style={THREE_UP} role="group" aria-label="סוג הוצאה">
          {KINDS.map((k) => (
            <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}
              className={`dash-range-btn${kind === k.id ? " is-active" : ""}`}>{k.label}</button>
          ))}
        </div>
        {hasVat && (
          <div className="dash-range rpt-modes" style={THREE_UP} role="group" aria-label="הצגת סכומים">
            {VAT_VIEWS.map((v) => (
              <button key={v.id} type="button" aria-pressed={vatView === v.id} onClick={() => setVatView(v.id)}
                className={`dash-range-btn${vatView === v.id ? " is-active" : ""}`}>{v.label}</button>
            ))}
          </div>
        )}
      </div>

      {!ready ? <p role="status" className="py-16 text-center text-stone-600">טוען את פרטי העסק...</p>
        : error ? <div role="alert" className="p-6 rounded-2xl bg-amber-50 text-amber-900"><p>{error}</p><button type="button" className="pgbtn pgbtn-quiet mt-3" onClick={retry}>ניסיון נוסף</button></div>
        : !data ? <p role="status" className="py-16 text-center text-stone-600">טוען את כל ההוצאות...</p>
        : <>
          <div className="flex flex-wrap gap-2 no-print">
            <DownloadPdfButton filename={`${filename}.pdf`} landscape disabled={report.rows.length === 0} />
            <button type="button" className="pgbtn pgbtn-quiet" onClick={() => window.print()} disabled={report.rows.length === 0}><Printer aria-hidden="true" />הדפסה</button>
            <button type="button" className="pgbtn pgbtn-quiet" onClick={exportExcel} disabled={busy || report.rows.length === 0} aria-busy={busy}><FileSpreadsheet aria-hidden="true" />{busy ? "מכין Excel..." : "ייצוא ל-Excel"}</button>
          </div>

          <article className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-8 space-y-6 print:border-0 print:p-0 print:space-y-4">
            <header className="border-b border-stone-200 pb-5">
              <p className="font-semibold text-stone-700 break-words">{business.name}</p>
              <p className="text-sm text-stone-600 mt-1">מספר עסק: {business.taxId}</p>
              <h2 className="text-2xl font-bold text-stone-900 mt-4">דוח הוצאות</h2>
              <p className="text-stone-600 mt-1">{scopeLabel} · סכומים בש״ח</p>
              <p className="text-sm text-stone-600 mt-1">הופק ב-{formatDate(todayInIsrael())}</p>
            </header>

            {report.rows.length === 0 ? (
              <p className="rounded-xl bg-stone-50 p-4 text-stone-700">אין הוצאות בתקופה ובסינון שבחרת. אפשר לבחור תקופה אחרת.</p>
            ) : <>
              <div className={`grid grid-cols-1 gap-3 ${hasVat ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2"}`}>
                <Stat label="מספר הוצאות" value={String(report.totals.count)} />
                {hasVat && <Stat label="לפני מע״מ" value={formatCurrency(report.totals.net)} />}
                {hasVat && (
                  <Stat label="מע״מ תשומות" value={formatCurrency(report.totals.vat)}
                    foot={`ציוד ${formatCurrency(report.totals.equipmentVat)} · אחרות ${formatCurrency(report.totals.otherVat)}`} />
                )}
                <Stat label={hasVat ? "כולל מע״מ" : "סה״כ הוצאות"} value={formatCurrency(report.totals.gross)} strong />
              </div>

              {filesVat && report.gapCount > 0 && (
                <div role="note" className="flex gap-3 rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-900 no-print">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm leading-relaxed">
                    ל-{report.gapCount} הוצאות חסרים פרטים שמע״מ דורש כדי להכיר בתשומה (מספר עוסק, מספר חשבונית או מספר הקצאה). הן מסומנות בטבלה.{" "}
                    <Link href="/expenses" className="font-semibold underline">להשלמה בעמוד ההוצאות</Link>
                  </p>
                </div>
              )}

              <section aria-label="לפי קטגוריה" className="break-inside-avoid">
                <h3 className="font-bold text-lg mb-3">לפי קטגוריה</h3>
                <div className="overflow-x-auto">
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th scope="col">קטגוריה</th>
                        <th scope="col" className="n rpt-col-wide">הוצאות</th>
                        {showNet && <th scope="col" className="n">לפני מע״מ</th>}
                        {showVatCol && <th scope="col" className="n">מע״מ</th>}
                        {showGross && <th scope="col" className="n">{hasVat ? "כולל מע״מ" : "סכום"}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {report.categories.map((c) => (
                        <tr key={c.category}>
                          <td>{c.category}</td>
                          <td className="n rpt-col-wide">{c.count}</td>
                          {showNet && <td className="n" dir="ltr">{formatCurrency(c.net)}</td>}
                          {showVatCol && <td className="n" dir="ltr">{formatCurrency(c.vat)}</td>}
                          {showGross && <td className="n" dir="ltr">{formatCurrency(c.gross)}</td>}
                        </tr>
                      ))}
                      <tr className="rpt-total">
                        <td>סה״כ</td>
                        <td className="n rpt-col-wide">{report.totals.count}</td>
                        {showNet && <td className="n" dir="ltr">{formatCurrency(report.totals.net)}</td>}
                        {showVatCol && <td className="n" dir="ltr">{formatCurrency(report.totals.vat)}</td>}
                        {showGross && <td className="n" dir="ltr">{formatCurrency(report.totals.gross)}</td>}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section aria-label="פירוט הוצאות">
                <h3 className="font-bold text-lg mb-3">פירוט הוצאות</h3>
                <div className="overflow-x-auto">
                  <table className="rpt-table rpt-table-dense">
                    <thead>
                      <tr>
                        <th scope="col">תאריך</th>
                        <th scope="col">ספק</th>
                        {showTaxId && <th scope="col" className="rpt-col-wide">מספר עוסק</th>}
                        {showRef && <th scope="col" className="rpt-col-wide">מספר חשבונית</th>}
                        <th scope="col" className="rpt-col-wide">קטגוריה</th>
                        {showNet && <th scope="col" className="n">לפני מע״מ</th>}
                        {showVatCol && <th scope="col" className="n">מע״מ</th>}
                        {showGross && <th scope="col" className="n">{hasVat ? "כולל מע״מ" : "סכום"}</th>}
                        {showAlloc && <th scope="col" className="rpt-col-wide">מספר הקצאה</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((r) => (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap tabular-nums">{formatDate(r.date)}</td>
                          <td className="min-w-[9rem]">
                            <Link href={`/expenses?edit=${r.id}`} className="font-semibold text-stone-900 hover:underline">{r.supplier || "-"}</Link>
                            {r.isEquipment && <span className="mr-2 text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">ציוד</span>}
                            {r.description && <span className="block text-xs text-stone-600">{r.description}</span>}
                            {filesVat && r.gaps.length > 0 && <span className="block text-xs font-semibold text-amber-800">{r.gaps.join(" · ")}</span>}
                          </td>
                          {showTaxId && <td className="tabular-nums whitespace-nowrap rpt-col-wide">{r.supplierTaxId || "-"}</td>}
                          {showRef && <td className="tabular-nums whitespace-nowrap rpt-col-wide">{r.reference || "-"}</td>}
                          <td className="whitespace-nowrap rpt-col-wide">{r.category}</td>
                          {showNet && <td className="n" dir="ltr">{formatCurrency(r.net)}</td>}
                          {showVatCol && <td className="n" dir="ltr">{formatCurrency(r.vat)}</td>}
                          {showGross && <td className="n" dir="ltr">{formatCurrency(r.gross)}</td>}
                          {showAlloc && <td className="tabular-nums whitespace-nowrap rpt-col-wide">{r.allocationNumber || "-"}</td>}
                        </tr>
                      ))}
                      <tr className="rpt-total">
                        <td colSpan={2}>סה״כ · {report.totals.count} הוצאות</td>
                        {showTaxId && <td className="rpt-col-wide" />}
                        {showRef && <td className="rpt-col-wide" />}
                        <td className="rpt-col-wide" />
                        {showNet && <td className="n" dir="ltr">{formatCurrency(report.totals.net)}</td>}
                        {showVatCol && <td className="n" dir="ltr">{formatCurrency(report.totals.vat)}</td>}
                        {showGross && <td className="n" dir="ltr">{formatCurrency(report.totals.gross)}</td>}
                        {showAlloc && <td className="rpt-col-wide" />}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {hasVat && (
                <p className="text-sm text-stone-600 leading-relaxed break-inside-avoid">
                  מע״מ תשומות מחולק לציוד ולהוצאות אחרות, כמו בטופס הדיווח התקופתי.
                  {filesVat && <> לדיווח עצמו ולקובץ PCN874: <Link href="/reports/vat" className="font-semibold text-orange-700 underline">דיווח מע״מ תקופתי</Link>.</>}
                </p>
              )}
            </>}
          </article>
        </>}
    </div>
  );
}

function Stat({ label, value, foot, strong = false }: { label: string; value: string; foot?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-4 ${strong ? "bg-emerald-50 border border-emerald-200" : "bg-stone-50"}`}>
      <p className="text-sm text-stone-700">{label}</p>
      <p dir="ltr" className="mt-2 text-2xl font-bold text-right tabular-nums text-stone-900">{value}</p>
      {foot && <p className="text-xs text-stone-600 mt-1">{foot}</p>}
    </div>
  );
}

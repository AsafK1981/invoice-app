"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Printer,
} from "lucide-react";
import { ReportPageHeader } from "@/components/report-page-header";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { useToast } from "@/components/ui/toast";
import { useBusiness } from "@/lib/business-store";
import { useFilingReportData } from "@/lib/filing-report-data";
import {
  buildPeriodicFiling,
  defaultFilingPeriod,
  isFilingPeriod,
  type FilingFigure,
  type IncomeRow,
} from "@/lib/periodic-filing";
import type { ExpenseReportRow } from "@/lib/expense-report";
import { periodMode, periodStepLabel, shiftPeriod, switchMode, type Period, type PeriodMode } from "@/lib/report-period";
import { downloadXlsx, sheet } from "@/lib/xlsx-export";
import { todayInIsrael } from "@/lib/date";
import { formatCurrency, formatCurrencyWhole, formatDate } from "@/lib/format";
import { DOCUMENT_STATUS_LABELS } from "@/lib/types";

/** The two cadences the Tax Authority files on. */
const MODES: { id: PeriodMode; label: string }[] = [
  { id: "bimonth", label: "חודשיים" },
  { id: "month", label: "חודש" },
];
const TWO_UP = { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" };

const VAT_SERVICE_URL = "https://www.gov.il/he/service/reporting-or-payment-of-vat-reports";
const ADVANCES_SERVICE_URL = "https://www.gov.il/he/service/itc-payment-online-incometax";

/**
 * דוח תקופתי לרשות המסים: one page, one period, both halves of the filing.
 *
 * The Tax Authority's periodic filing asks for income (עסקאות) and expenses
 * (תשומות) in the same submission, plus the income-tax advance on the same
 * turnover. The app had each piece on its own page; this page puts them in
 * filing order for the month or bi-month the user is about to file: what to
 * type, then the income rows and the expense rows those figures are made of.
 * Every number comes from the same generators as /reports/vat and
 * /reports/advances (src/lib/periodic-filing.ts), so the pages agree.
 */
export default function PeriodicFilingPage() {
  const { business, ready } = useBusiness();
  const { data, error, retry } = useFilingReportData(ready ? business.id : "", true);
  const toast = useToast();
  const [period, setPeriod] = useState<Period>(() => defaultFilingPeriod());
  // The period rides in the URL so a fix-it trip to an expense or a document
  // lands back on the same period. Read on mount, not via useSearchParams,
  // which would force a Suspense boundary around the whole page.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("period");
    if (fromUrl && isFilingPeriod(fromUrl)) setPeriod(fromUrl);
    setUrlRead(true);
  }, []);
  function changePeriod(next: Period) {
    setPeriod(next);
    window.history.replaceState(window.history.state, "", `/reports/periodic?period=${next}`);
  }

  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string, key: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const filing = useMemo(
    () => (data ? buildPeriodicFiling({ business, documents: data.documents, expenses: data.expenses, period }) : null),
    [data, business, period],
  );

  const [busy, setBusy] = useState(false);
  async function exportExcel() {
    if (!filing || busy) return;
    setBusy(true);
    try {
      const meta = { businessName: `${business.name} | מספר עסק: ${business.taxId}`, subtitle: filing.range.label };
      const figures = [
        ...filing.vatFigures.map((f) => ({ group: "מע״מ", ...f })),
        ...filing.advanceFigures.map((f) => ({ group: "מקדמות מס הכנסה", ...f })),
      ];
      await downloadXlsx(`periodic-filing-${period}.xlsx`, [
        sheet<(typeof figures)[number]>({
          ...meta,
          name: "מה להקליד",
          title: "דוח תקופתי לרשות המסים - הסכומים לטופס",
          rows: figures,
          columns: [
            { header: "דיווח", value: (r) => r.group },
            { header: "שדה", value: (r) => r.label, width: 36 },
            { header: "ערך", value: (r) => (r.display ? r.display : r.value), kind: "money" },
          ],
          notes: [
            "הסכומים בשקלים שלמים, כפי שהטופס המקוון דורש.",
            `מועד הדיווח והתשלום: ${formatDate(filing.dueDate)}.`,
          ],
        }),
        sheet<IncomeRow>({
          ...meta,
          name: "הכנסות",
          title: "הכנסות בתקופה",
          countLabel: `${filing.income.totals.count} מסמכים`,
          rows: filing.income.rows,
          columns: [
            { header: "תאריך", value: (r) => r.date, kind: "date" },
            { header: "סוג מסמך", value: (r) => r.typeLabel },
            { header: "מספר", value: (r) => r.number, kind: "int" },
            { header: "לקוח", value: (r) => r.clientName, width: 28 },
            { header: "סטטוס", value: (r) => DOCUMENT_STATUS_LABELS[r.status] },
            { header: "לפני מע״מ", value: (r) => r.net, kind: "money", total: "sum" },
            { header: "מע״מ", value: (r) => r.vat, kind: "money", total: "sum" },
            { header: "סה״כ", value: (r) => r.gross, kind: "money", total: "sum" },
          ],
        }),
        sheet<ExpenseReportRow>({
          ...meta,
          name: "הוצאות",
          title: "הוצאות בתקופה",
          countLabel: `${filing.expenses.totals.count} הוצאות`,
          rows: filing.expenses.rows,
          columns: [
            { header: "תאריך", value: (r) => r.date, kind: "date" },
            { header: "ספק", value: (r) => r.supplier, width: 28 },
            { header: "קטגוריה", value: (r) => r.category },
            { header: "סוג", value: (r) => (r.isEquipment ? "ציוד" : "שוטפת") },
            { header: "לפני מע״מ", value: (r) => r.net, kind: "money", total: "sum" },
            { header: "מע״מ", value: (r) => r.vat, kind: "money", total: "sum" },
            { header: "כולל מע״מ", value: (r) => r.gross, kind: "money", total: "sum" },
          ],
        }),
      ]);
    } catch {
      toast("יצירת קובץ Excel נכשלה. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  const hasVat = business.businessType === "authorized" || business.businessType === "company";
  const mode = periodMode(period);
  const empty = !!filing && filing.income.rows.length === 0 && filing.expenses.rows.length === 0;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="no-print">
        <ReportPageHeader
          icon={CalendarCheck}
          title="דוח תקופתי לרשות המסים"
          subtitle="ההכנסות וההוצאות של התקופה ומה להקליד בדיווח התקופתי, מע״מ ומקדמות מס הכנסה, בדוח אחד."
          period={filing?.range.label}
        />
      </div>

      <div className="rpt-controls no-print">
        <div className="dash-range rpt-modes" style={TWO_UP} role="group" aria-label="תדירות הדיווח">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id}
              onClick={() => changePeriod(switchMode(period, m.id))}
              className={`dash-range-btn${mode === m.id ? " is-active" : ""}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="rpt-stepper" role="group" aria-label="בחירת תקופת דיווח">
          <button type="button" onClick={() => changePeriod(shiftPeriod(period, -1))} aria-label="תקופה קודמת">
            <ChevronRight aria-hidden="true" />
          </button>
          <b>{periodStepLabel(period)}</b>
          <button type="button" onClick={() => changePeriod(shiftPeriod(period, 1))} aria-label="תקופה הבאה">
            <ChevronLeft aria-hidden="true" />
          </button>
        </div>
      </div>

      {!ready || !urlRead ? (
        <p role="status" className="py-16 text-center text-stone-600">טוען את פרטי העסק...</p>
      ) : error ? (
        <div role="alert" className="p-6 rounded-2xl bg-amber-50 text-amber-900">
          <p>{error}</p>
          <button type="button" className="pgbtn pgbtn-quiet mt-3" onClick={retry}>ניסיון נוסף</button>
        </div>
      ) : !data || !filing ? (
        <p role="status" className="py-16 text-center text-stone-600">טוען את המסמכים וההוצאות...</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 no-print">
            <DownloadPdfButton filename={`periodic-filing-${period}.pdf`} disabled={empty} />
            <button type="button" className="pgbtn pgbtn-quiet" onClick={() => window.print()} disabled={empty}>
              <Printer aria-hidden="true" />הדפסה
            </button>
            <button type="button" className="pgbtn pgbtn-quiet" onClick={exportExcel} disabled={busy || empty} aria-busy={busy}>
              <FileSpreadsheet aria-hidden="true" />{busy ? "מכין Excel..." : "ייצוא ל-Excel"}
            </button>
          </div>

          <article className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-8 space-y-6 print:border-0 print:p-0 print:space-y-4">
            <header className="border-b border-stone-200 pb-5">
              <p className="font-semibold text-stone-700 break-words">{business.name}</p>
              <p className="text-sm text-stone-600 mt-1">מספר עסק: {business.taxId}</p>
              <h2 className="text-2xl font-bold text-stone-900 mt-4">דוח תקופתי לרשות המסים</h2>
              <p className="text-stone-600 mt-1">
                {filing.range.label} · {formatDate(filing.range.start)} עד {formatDate(filing.range.end)} · סכומים בש״ח
              </p>
              <p className="text-sm text-stone-600 mt-1">הופק ב-{formatDate(todayInIsrael())}</p>
            </header>

            {/* ---------- when to file ---------- */}
            <p
              role="status"
              className={`rounded-xl border p-4 text-sm leading-relaxed ${
                filing.ended ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              {filing.ended ? (
                <>
                  <b>התקופה הסתיימה ואפשר לדווח.</b> מועד הדיווח והתשלום: {formatDate(filing.dueDate)}.
                </>
              ) : (
                <>
                  <b>התקופה עדיין לא הסתיימה.</b> הסכומים כאן יתעדכנו עד {formatDate(filing.range.end)}, והדיווח מוגש עד {formatDate(filing.dueDate)}.
                </>
              )}
            </p>

            {/* ---------- what to type ---------- */}
            <section aria-label="מה להקליד בדוח התקופתי" className="break-inside-avoid">
              <h3 className="font-bold text-lg mb-3">מה להקליד בדוח התקופתי</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <FigureCard
                  title="מע״מ"
                  figures={filing.vatFigures}
                  copied={copied}
                  onCopy={copy}
                  empty={
                    !hasVat ? (
                      <p className="text-sm text-stone-700 leading-relaxed">
                        עוסק פטור לא מגיש דוח מע״מ תקופתי. במקום זה מדווחים פעם בשנה, עד 31 בינואר, את המחזור השנתי:{" "}
                        <Link href="/reports/vat" className="font-semibold text-orange-700 underline">הצהרת עוסק פטור שנתית</Link>.
                      </p>
                    ) : undefined
                  }
                  foot={
                    hasVat ? (
                      <>
                        <a href={VAT_SERVICE_URL} target="_blank" rel="noopener" className="no-print inline-flex items-center gap-1.5 min-h-[40px] text-sm font-semibold text-orange-700 hover:underline">
                          לדיווח מע״מ באתר רשות המסים
                          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        </a>
                        <Link href={`/reports/vat?period=${mode === "month" ? "last_month" : "last_2m"}`} className="no-print block text-sm text-stone-700 hover:underline">
                          חייבים בדיווח מפורט? קובץ PCN874 והבדיקות לפני ההגשה נמצאים בדיווח המע״מ.
                        </Link>
                      </>
                    ) : undefined
                  }
                />
                <FigureCard
                  title="מקדמות מס הכנסה"
                  figures={filing.advanceFigures}
                  copied={copied}
                  onCopy={copy}
                  note={
                    filing.advance.ratePercent === 0 ? (
                      <p className="rounded-xl bg-orange-50 border border-orange-100 p-3 text-sm text-stone-800 leading-relaxed">
                        עדיין לא הוגדר אחוז מקדמה. האחוז מופיע בפנקס המקדמות מפקיד השומה.{" "}
                        <Link href="/reports/advances" className="no-print font-semibold text-orange-700 underline">להגדרת האחוז</Link>
                      </p>
                    ) : filing.advance.carriedToAnnual > 0 ? (
                      <p className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900">
                        עודף ניכוי במקור של {formatCurrencyWhole(filing.advance.carriedToAnnual)} לא אבד, הוא מתקזז בדוח השנתי.
                      </p>
                    ) : undefined
                  }
                  foot={
                    <a href={ADVANCES_SERVICE_URL} target="_blank" rel="noopener" className="no-print inline-flex items-center gap-1.5 min-h-[40px] text-sm font-semibold text-orange-700 hover:underline">
                      לדיווח ותשלום מקדמות באתר רשות המסים
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  }
                />
              </div>
              <p className="text-xs text-stone-600 mt-3 leading-relaxed">
                הסכומים מעוגלים לשקלים שלמים כפי שהטפסים דורשים. מע״מ נספר לפי חשבוניות המס שהופקו בתקופה; המחזור למקדמות לפי המסמכים ששולמו בתקופה. חשבוניות זיכוי מקטינות את שניהם.
              </p>
            </section>

            {/* ---------- income ---------- */}
            <section aria-label="הכנסות בתקופה">
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
                <h3 className="font-bold text-lg">הכנסות בתקופה</h3>
                <span className="text-sm text-stone-600">{filing.income.totals.count} מסמכים</span>
              </div>
              {filing.income.rows.length === 0 ? (
                <p className="rounded-xl bg-stone-50 p-4 text-stone-700">אין מסמכי הכנסה בתקופה שנבחרה.</p>
              ) : (
                <>
                <ul className="sm:hidden print:hidden space-y-2">
                  {filing.income.rows.map((r) => (
                    <li key={r.id} className="rounded-xl border border-stone-200 bg-white px-3.5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link href={`/documents/${r.id}`} className="font-semibold text-stone-900 truncate hover:underline">{r.typeLabel} {r.number}</Link>
                        <span className="font-extrabold text-stone-900 tabular-nums whitespace-nowrap" dir="ltr">{formatCurrency(r.gross)}</span>
                      </div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-stone-600">
                        <span className="truncate"><span className="tabular-nums">{formatDate(r.date)}</span>{r.clientName ? ` · ${r.clientName}` : ""} · {DOCUMENT_STATUS_LABELS[r.status]}</span>
                        {hasVat && <span className="tabular-nums whitespace-nowrap">מע״מ {formatCurrency(r.vat)}</span>}
                      </div>
                    </li>
                  ))}
                  <li className="rounded-xl bg-orange-50 border border-orange-200 px-3.5 py-3 font-black text-stone-900">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>סה״כ · {filing.income.totals.count} מסמכים</span>
                      <span className="tabular-nums" dir="ltr">{formatCurrency(filing.income.totals.gross)}</span>
                    </div>
                    {hasVat && (
                      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs font-semibold text-stone-600">
                        <span>לפני מע״מ {formatCurrency(filing.income.totals.net)}</span>
                        <span>מע״מ {formatCurrency(filing.income.totals.vat)}</span>
                      </div>
                    )}
                  </li>
                </ul>
                <div className="hidden sm:block print:block overflow-x-auto">
                  <table className="rpt-table rpt-table-dense">
                    <thead>
                      <tr>
                        <th scope="col">תאריך</th>
                        <th scope="col">מסמך</th>
                        <th scope="col">לקוח</th>
                        <th scope="col" className="rpt-col-wide">סטטוס</th>
                        {hasVat && <th scope="col" className="n">לפני מע״מ</th>}
                        {hasVat && <th scope="col" className="n">מע״מ</th>}
                        <th scope="col" className="n">{hasVat ? "סה״כ" : "סכום"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filing.income.rows.map((r) => (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap tabular-nums">{formatDate(r.date)}</td>
                          <td className="whitespace-nowrap">
                            <Link href={`/documents/${r.id}`} className="font-semibold text-stone-900 hover:underline">
                              {r.typeLabel} {r.number}
                            </Link>
                          </td>
                          <td className="min-w-[9rem]">{r.clientName || "-"}</td>
                          <td className="whitespace-nowrap rpt-col-wide">
                            {DOCUMENT_STATUS_LABELS[r.status]}
                            {hasVat && r.inVat && !r.inTurnover && (
                              <span className="block text-xs text-stone-600">במע״מ, עדיין לא במקדמות</span>
                            )}
                          </td>
                          {hasVat && <td className="n" dir="ltr">{formatCurrency(r.net)}</td>}
                          {hasVat && <td className="n" dir="ltr">{formatCurrency(r.vat)}</td>}
                          <td className="n" dir="ltr">{formatCurrency(r.gross)}</td>
                        </tr>
                      ))}
                      <tr className="rpt-total">
                        <td colSpan={3}>סה״כ · {filing.income.totals.count} מסמכים</td>
                        <td className="rpt-col-wide" />
                        {hasVat && <td className="n" dir="ltr">{formatCurrency(filing.income.totals.net)}</td>}
                        {hasVat && <td className="n" dir="ltr">{formatCurrency(filing.income.totals.vat)}</td>}
                        <td className="n" dir="ltr">{formatCurrency(filing.income.totals.gross)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </section>

            {/* ---------- expenses ---------- */}
            <section aria-label="הוצאות בתקופה">
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
                <h3 className="font-bold text-lg">הוצאות בתקופה</h3>
                <span className="text-sm text-stone-600">{filing.expenses.totals.count} הוצאות</span>
              </div>
              {filing.expenses.rows.length === 0 ? (
                <p className="rounded-xl bg-stone-50 p-4 text-stone-700">
                  אין הוצאות בתקופה שנבחרה.{" "}
                  <Link href="/expenses?new=1" className="no-print font-semibold text-orange-700 underline">להוספת הוצאה</Link>
                </p>
              ) : (
                <>
                <ul className="sm:hidden print:hidden space-y-2">
                  {filing.expenses.rows.map((r) => (
                    <li key={r.id} className="rounded-xl border border-stone-200 bg-white px-3.5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link href={`/expenses?edit=${r.id}`} className="font-semibold text-stone-900 truncate hover:underline">{r.supplier || "ללא ספק"}</Link>
                        <span className="font-extrabold text-stone-900 tabular-nums whitespace-nowrap" dir="ltr">{formatCurrency(r.gross)}</span>
                      </div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-stone-600">
                        <span className="truncate"><span className="tabular-nums">{formatDate(r.date)}</span> · {r.category}{r.isEquipment ? " · ציוד" : ""}{r.description ? ` · ${r.description}` : ""}</span>
                        {hasVat && <span className="tabular-nums whitespace-nowrap">מע״מ {formatCurrency(r.vat)}</span>}
                      </div>
                      {hasVat && r.gaps.length > 0 && <span className="block mt-0.5 text-xs font-semibold text-amber-800">{r.gaps.join(" · ")}</span>}
                    </li>
                  ))}
                  <li className="rounded-xl bg-orange-50 border border-orange-200 px-3.5 py-3 font-black text-stone-900">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>סה״כ · {filing.expenses.totals.count} הוצאות</span>
                      <span className="tabular-nums" dir="ltr">{formatCurrency(filing.expenses.totals.gross)}</span>
                    </div>
                    {hasVat && (
                      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs font-semibold text-stone-600">
                        <span>לפני מע״מ {formatCurrency(filing.expenses.totals.net)}</span>
                        <span>מע״מ {formatCurrency(filing.expenses.totals.vat)}</span>
                      </div>
                    )}
                  </li>
                </ul>
                <div className="hidden sm:block print:block overflow-x-auto">
                  <table className="rpt-table rpt-table-dense">
                    <thead>
                      <tr>
                        <th scope="col">תאריך</th>
                        <th scope="col">ספק</th>
                        <th scope="col" className="rpt-col-wide">קטגוריה</th>
                        {hasVat && <th scope="col" className="n">לפני מע״מ</th>}
                        {hasVat && <th scope="col" className="n">מע״מ</th>}
                        <th scope="col" className="n">{hasVat ? "כולל מע״מ" : "סכום"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filing.expenses.rows.map((r) => (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap tabular-nums">{formatDate(r.date)}</td>
                          <td className="min-w-[9rem]">
                            <Link href={`/expenses?edit=${r.id}`} className="font-semibold text-stone-900 hover:underline">{r.supplier || "-"}</Link>
                            {r.isEquipment && <span className="mr-2 text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">ציוד</span>}
                            {r.description && <span className="block text-xs text-stone-600">{r.description}</span>}
                            {hasVat && r.gaps.length > 0 && <span className="block text-xs font-semibold text-amber-800">{r.gaps.join(" · ")}</span>}
                          </td>
                          <td className="whitespace-nowrap rpt-col-wide">{r.category}</td>
                          {hasVat && <td className="n" dir="ltr">{formatCurrency(r.net)}</td>}
                          {hasVat && <td className="n" dir="ltr">{formatCurrency(r.vat)}</td>}
                          <td className="n" dir="ltr">{formatCurrency(r.gross)}</td>
                        </tr>
                      ))}
                      <tr className="rpt-total">
                        <td colSpan={2}>סה״כ · {filing.expenses.totals.count} הוצאות</td>
                        <td className="rpt-col-wide" />
                        {hasVat && <td className="n" dir="ltr">{formatCurrency(filing.expenses.totals.net)}</td>}
                        {hasVat && <td className="n" dir="ltr">{formatCurrency(filing.expenses.totals.vat)}</td>}
                        <td className="n" dir="ltr">{formatCurrency(filing.expenses.totals.gross)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                </>
              )}
              {hasVat && filing.expenses.totals.count > 0 && (
                <p className="text-xs text-stone-600 mt-2 leading-relaxed">
                  מע״מ תשומות: ציוד {formatCurrency(filing.expenses.totals.equipmentVat)} · אחרות {formatCurrency(filing.expenses.totals.otherVat)}, כמו בשני השדות של הטופס.
                </p>
              )}
            </section>

            <p className="text-xs text-stone-600 leading-relaxed border-t border-stone-200 pt-3 break-inside-avoid">
              הדוח מרכז את הנתונים שהוזנו באפליקציה לתקופה שנבחרה ומיועד להכנת הדיווח המקוון. הוא אינו אישור קליטה של רשות המסים ואינו תחליף לבדיקת רואה החשבון.
            </p>
          </article>
        </>
      )}
    </div>
  );
}

/** One half of the "what to type" block: a titled list of figures, each with a copy button. */
function FigureCard({
  title,
  figures,
  copied,
  onCopy,
  empty,
  note,
  foot,
}: {
  title: string;
  figures: FilingFigure[];
  copied: string | null;
  onCopy: (text: string, key: string) => void;
  empty?: React.ReactNode;
  note?: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/60 p-4 break-inside-avoid">
      <h4 className="font-bold text-stone-900">{title}</h4>
      {figures.length === 0 ? (
        <div className="mt-3">{empty}</div>
      ) : (
        <ul className="mt-2 divide-y divide-stone-200">
          {figures.map((row) => {
            const key = `${title}-${row.key}`;
            return (
              <li key={row.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5">
                <span className="text-sm text-stone-800">
                  {row.label}
                  {row.hint && <span className="block text-xs text-stone-600">{row.hint}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <b className="text-base font-extrabold text-stone-900 tabular-nums" dir="ltr">
                    {row.display ?? formatCurrencyWhole(row.value)}
                  </b>
                  <button
                    type="button"
                    onClick={() => onCopy(String(row.value), key)}
                    title="העתק את המספר בלבד"
                    className="no-print inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] px-2.5 rounded-xl text-xs font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
                  >
                    {copied === key ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                        הועתק
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" aria-hidden="true" />
                        העתק
                      </>
                    )}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {note && <div className="mt-3">{note}</div>}
      {foot && <div className="mt-3 border-t border-stone-200 pt-2 space-y-1">{foot}</div>}
    </div>
  );
}

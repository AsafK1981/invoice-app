"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Printer,
  Receipt,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  Copy,
  Check,
  FileDown,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Business, InvoiceDocument, Expense } from "@/lib/types";
import { exportVatPeriodExpenses } from "@/lib/csv-export";
import { biMonthlyRange, singleMonthRange, yearRange } from "@/lib/ita/vat-periods";
import { buildPcn874, validatePcn874Content, PCN_ENTRY_LABELS } from "@/lib/ita/pcn874";
import { exemptDealerAnnualTurnover, exemptDeclarationDeadline, roundShekelHalfUp } from "@/lib/ita/income-tax-advances";
import { getExemptCeiling } from "@/lib/tax-thresholds";

interface Props {
  business: Business;
  documents: InvoiceDocument[];
  expenses: Expense[];
  /** On its own /reports/vat page the page header already carries the title; keep only the range line. */
  headless?: boolean;
}

type PeriodMode = "this_2m" | "last_2m" | "this_month" | "last_month" | "this_year";

const MODE_LABELS: Record<PeriodMode, string> = {
  this_2m: "תקופה דו-חודשית נוכחית",
  last_2m: "תקופה דו-חודשית קודמת",
  this_month: "חודש נוכחי",
  last_month: "חודש קודם",
  this_year: "שנה נוכחית",
};

/** The figures typed into the periodic return, in form order. */
interface CopyRow {
  label: string;
  /** Whole shekels. */
  value: number;
  hint?: string;
}

export function VatPeriodReport({ headless = false, business, documents, expenses }: Props) {
  // ALL hooks must run before any conditional return, same trap as
  // React #310 yesterday. The early return for עוסק פטור comes last.
  const [mode, setMode] = useState<PeriodMode>("this_2m");
  // Stable across renders. Without memo, the next two useMemos invalidate
  // every render because Date instances aren't ===; the report would
  // re-aggregate documents/expenses on every keystroke elsewhere on the
  // page. Recompute would be wasted work; the period only depends on
  // today's calendar date, which doesn't change for the life of the
  // component instance (worst case: midnight rollover, acceptable).
  const today = useMemo(() => new Date(), []);
  const range = useMemo(() => {
    switch (mode) {
      case "this_2m": return biMonthlyRange(today, 0);
      case "last_2m": return biMonthlyRange(today, -1);
      case "this_month": return singleMonthRange(today, 0);
      case "last_month": return singleMonthRange(today, -1);
      case "this_year": return yearRange(today);
    }
    // unreachable, satisfies TS
    return biMonthlyRange(today, 0);
  }, [mode, today]);

  const stats = useMemo(() => {
    const docsInRange = documents.filter(
      (d) => d.date >= range.start && d.date <= range.end &&
             d.status !== "draft" && d.status !== "cancelled"
    );
    const expensesInRange = expenses.filter(
      (e) => e.date >= range.start && e.date <= range.end
    );

    // Output VAT (מע"מ עסקאות) = sum of VAT charged on tax invoices and
    // tax-invoice-receipts. Credit notes are stored ALREADY NEGATIVE on save
    // (receipt-editor.tsx applies `sign = -1` to vat/subtotal), so folding
    // them into the same `+=` as invoices already nets them out; a `-=`
    // branch here would double-negate and add a refund's VAT back in as if
    // it were more output VAT.
    let outputVat = 0;
    let taxableSales = 0;
    for (const d of docsInRange) {
      if (d.type === "tax_invoice" || d.type === "tax_invoice_receipt" || d.type === "credit_note") {
        outputVat += (d.vatIls ?? d.vat);
        taxableSales += (d.subtotalIls ?? d.subtotal);
      }
    }

    // Input VAT (מע"מ תשומות) = sum of vat_amount on expenses in period.
    // Clamp negative net-of-VAT to 0 in case the user typed a vat_amount
    // larger than the total amount (typo); base shouldn't go negative.
    let inputVat = 0;
    let inputBase = 0;
    let inputGross = 0;
    const expenseRows = [...expensesInRange]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((e) => {
        const vat = e.vatAmount || 0;
        const net = Math.max(0, e.amount - vat);
        inputVat += vat;
        inputBase += net;
        inputGross += e.amount;
        return { ...e, vat, net };
      });

    return {
      outputVat,
      inputVat,
      netDue: outputVat - inputVat,
      taxableSales,
      inputBase,
      docCount: docsInRange.filter(
        (d) => d.type === "tax_invoice" || d.type === "tax_invoice_receipt" || d.type === "credit_note"
      ).length,
      expenseCount: expensesInRange.length,
      expenseRows,
      inputGross,
    };
  }, [documents, expenses, range]);

  // The detailed file + the six form figures come from one generator, so the
  // numbers on screen and the numbers in the uploaded file can never diverge.
  const pcn = useMemo(
    () => buildPcn874({ business, documents, expenses, range }),
    [business, documents, expenses, range],
  );
  // Whole-file blockers (dealer number, period shape, period still open) come
  // first; the byte-level self-check only matters once those are clear.
  const pcnProblems = useMemo(
    () => [...pcn.blockers, ...validatePcn874Content(pcn.content)],
    [pcn.blockers, pcn.content],
  );

  const formRows = useMemo<CopyRow[]>(() => {
    const f = pcn.figures;
    const refund = f.netDue < 0;
    return [
      { label: "עסקאות חייבות (ללא מע״מ)", value: f.taxableSales },
      { label: "מס עסקאות", value: f.outputVat },
      { label: "עסקאות פטורות או בשיעור אפס", value: f.zeroOrExemptSales },
      { label: "מס תשומות ציוד", value: f.equipmentInputVat },
      { label: "מס תשומות אחרות", value: f.otherInputVat },
      {
        label: refund ? "סה״כ להחזר" : "סה״כ לתשלום",
        value: Math.abs(f.netDue),
        hint: refund ? "התשומות עולות על העסקאות" : undefined,
      },
    ];
  }, [pcn.figures]);

  /** One record-count line per PCN874 record type actually produced. */
  const pcnCounts = useMemo(() => {
    const byType = new Map<string, { records: number; docs: number }>();
    for (const t of pcn.transactions) {
      const cur = byType.get(t.entryType) ?? { records: 0, docs: 0 };
      cur.records += 1;
      cur.docs += t.sourceIds.length;
      byType.set(t.entryType, cur);
    }
    return [...byType.entries()].map(([type, c]) => {
      const label = PCN_ENTRY_LABELS[type as keyof typeof PCN_ENTRY_LABELS] ?? type;
      // L / K are aggregate records: the interesting number is how many
      // app rows they fold in, not the single line in the file.
      const summary =
        type === "L" || type === "K"
          ? `ריכוז ${c.docs} מסמכים`
          : `${c.records} רשומות`;
      return { type, label, summary };
    });
  }, [pcn.transactions]);

  // ── הצהרת עוסק פטור (the exempt branch, further down) ──
  // Until 30 April the declaration people are looking for is still last
  // year's, so that is the year the picker opens on.
  const [exemptYear, setExemptYear] = useState(() => {
    const now = new Date();
    return now.getMonth() <= 3 ? now.getFullYear() - 1 : now.getFullYear();
  });
  const exempt = useMemo(() => {
    const totals = exemptDealerAnnualTurnover(documents, exemptYear);
    const turnover = roundShekelHalfUp(totals.turnover);
    const ceiling = getExemptCeiling(exemptYear);
    return { ...totals, turnover, ceiling, overCeiling: turnover > ceiling };
  }, [documents, exemptYear]);

  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string, key: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  /** Hand the file over as-is: ASCII, CRLF, the name the ITA expects. */
  function downloadPcn() {
    const blob = new Blob([pcn.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = pcn.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Detailed expense listing for the accountant: styled .xlsx with a total
  // row (csv-export.ts), same anatomy as the printed report.
  function exportExpensesCsv() {
    void exportVatPeriodExpenses({
      rows: stats.expenseRows,
      range: {
        start: range.start,
        end: range.end,
        label: `${range.label} · ${formatDate(range.start)} עד ${formatDate(range.end)}`,
      },
      businessName: business.name,
    });
  }

  // עוסק פטור files no periodic VAT return at all - one annual turnover
  // declaration instead. That is a different report, so it gets its own card
  // rather than an empty page.
  if (business.businessType !== "authorized" && business.businessType !== "company") {
    const thisYear = new Date().getFullYear();
    const yearOptions = [thisYear, thisYear - 1];
    return (
      <div className="card-soft p-6 print:shadow-none">
        <div
          className={`flex items-start gap-3 flex-wrap mb-4 ${headless ? "justify-end" : "justify-between"}`}
        >
          {!headless && (
            <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-orange-500" />
              הצהרת עוסק פטור על מחזור העסקאות
            </h2>
          )}
          <select
            value={exemptYear}
            onChange={(e) => setExemptYear(Number(e.target.value))}
            aria-label="שנת ההצהרה"
            className="input-warm py-1.5 px-3 text-sm w-auto max-w-[14rem]"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{`שנת ${y}`}</option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4">
          <div className="text-xs font-medium text-orange-700 mb-1">מחזור העסקאות בשנת {exemptYear}</div>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-2xl font-bold text-stone-900 tabular-nums" dir="ltr">
              {formatCurrency(exempt.turnover)}
            </p>
            <button
              type="button"
              onClick={() => copy(String(exempt.turnover), "exempt-turnover")}
              className="no-print inline-flex items-center gap-2 min-h-[40px] px-3 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
            >
              {copied === "exempt-turnover" ? (
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
          </div>
          <p className="text-xs text-stone-600 mt-1">
            על {exempt.docCount} מסמכים שהופקו בשנה, בשקלים שלמים
          </p>
        </div>

        <p className="text-sm text-stone-700 mt-4">
          יש להגיש עד {formatDate(exemptDeclarationDeadline(exemptYear))} באזור האישי באתר רשות המסים (טופס מקוון, לא קובץ).
        </p>
        <p
          className={`text-sm mt-2 font-semibold ${exempt.overCeiling ? "text-rose-700" : "text-emerald-700"}`}
        >
          {exempt.overCeiling
            ? `המחזור חורג מתקרת עוסק פטור לשנת ${exemptYear} (${formatCurrency(exempt.ceiling)}) - יש לבדוק מעבר לעוסק מורשה.`
            : `המחזור מתחת לתקרת עוסק פטור לשנת ${exemptYear} (${formatCurrency(exempt.ceiling)}).`}
        </p>
        <p className="text-xs text-stone-600 mt-3 leading-relaxed border-t border-orange-100 pt-3">
          המחזור מחושב לפי כל המסמכים שהופקו בשנה (גם אם טרם שולמו), בלי טיוטות וביטולים, וחשבוניות זיכוי מקטינות אותו. זו אותה הגדרה כמו מד התקרה בדף הראשי.
          עוסק פטור אינו מדווח מע״מ תקופתי ואינו מגיש קובץ.
        </p>
      </div>
    );
  }

  // The tiles, the six form rows and the file all read from one generator, so
  // the screen can never show two different totals for the same period.
  const refundDue = pcn.figures.netDue < 0;

  return (
    <div className="card-soft p-6 print:shadow-none">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          {!headless && (
            <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-orange-500" />
              דיווח מע״מ תקופתי
            </h2>
          )}
          <p className={`text-sm text-stone-700 ${headless ? "font-semibold self-center" : "mt-1"}`}>
            {range.label} · {formatDate(range.start)} עד {formatDate(range.end)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as PeriodMode)}
            className="input-warm py-1.5 px-3 text-sm w-auto max-w-[14rem]"
          >
            {(Object.keys(MODE_LABELS) as PeriodMode[]).map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m]}</option>
            ))}
          </select>
          <DownloadPdfButton
            filename={`דוח-מעמ-${range.label}`}
            className="no-print inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
            iconClassName="w-4 h-4"
          />
          <button
            onClick={() => window.print()}
            className="no-print inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
          >
            <Printer className="w-4 h-4" />
            הדפס
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 mb-1">
            <ArrowUpFromLine className="w-3.5 h-3.5" />
            מע״מ עסקאות (פלט)
          </div>
          <p className="text-2xl font-bold text-stone-900" dir="ltr">{formatCurrency(pcn.figures.outputVat)}</p>
          <p className="text-xs text-stone-600 mt-1">
            על {stats.docCount} מסמכי מס · בסיס {formatCurrency(pcn.figures.taxableSales)}
          </p>
        </div>
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-rose-700 mb-1">
            <ArrowDownToLine className="w-3.5 h-3.5" />
            מע״מ תשומות (קלט)
          </div>
          <p className="text-2xl font-bold text-stone-900" dir="ltr">
            {formatCurrency(pcn.figures.equipmentInputVat + pcn.figures.otherInputVat)}
          </p>
          <p className="text-xs text-stone-600 mt-1">
            על {stats.expenseCount} הוצאות · בסיס {formatCurrency(stats.inputBase)}
          </p>
        </div>
        <div
          className={`rounded-2xl border p-4 ${
            refundDue ? "bg-blue-50 border-blue-200" : "bg-orange-50 border-orange-200"
          }`}
        >
          <div
            className={`text-xs font-medium mb-1 ${refundDue ? "text-blue-700" : "text-orange-700"}`}
          >
            {refundDue ? "החזר ממע״מ" : "מע״מ לתשלום"}
          </div>
          <p className="text-2xl font-bold text-stone-900" dir="ltr">
            {formatCurrency(Math.abs(pcn.figures.netDue))}
          </p>
          <p className="text-xs text-stone-600 mt-1">
            {refundDue
              ? "תשומות עולות על עסקאות"
              : "סכום להעביר לרשות המסים"}
          </p>
        </div>
      </div>

      {/* ---------- the six numbers the periodic return form asks for ---------- */}
      <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-4">
        <h3 className="font-bold text-stone-900">מה להקליד בדוח התקופתי באתר רשות המסים</h3>
        <ul className="mt-3 divide-y divide-stone-100">
          {formRows.map((row, i) => (
            <li
              key={row.label}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5"
            >
              <span className="text-sm text-stone-800">
                {row.label}
                {row.hint && <span className="block text-xs text-stone-600">{row.hint}</span>}
              </span>
              <span className="flex items-center gap-2">
                <b className="text-base font-extrabold text-stone-900 tabular-nums" dir="ltr">
                  {formatCurrency(row.value)}
                </b>
                <button
                  type="button"
                  onClick={() => copy(String(Math.round(row.value)), `form-${i}`)}
                  title="העתק את המספר בלבד"
                  className="no-print inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] px-2.5 rounded-xl text-xs font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
                >
                  {copied === `form-${i}` ? (
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
          ))}
        </ul>
        <p className="text-xs text-stone-600 mt-3 leading-relaxed">
          הסכומים מעוגלים לשקלים שלמים כפי שהטופס דורש. מועד הדיווח והתשלום: עד ה-15 בחודש שאחרי תקופת הדיווח.
        </p>
      </section>

      {/* ---------- PCN874: the detailed file that rides along with the return ---------- */}
      <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-4">
        <h3 className="font-bold text-stone-900">דיווח מפורט (PCN874)</h3>
        <p className="text-sm text-stone-700 mt-1 leading-relaxed">
          זה הקובץ שמעלים בשירות &quot;דיווח מפורט&quot; באתר רשות המסים יחד עם הדוח התקופתי.
        </p>

        {pcn.transactions.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-stone-200 p-6 text-center text-sm text-stone-600">
            אין עסקאות או תשומות בתקופה שנבחרה, ולכן אין מה לדווח בדיווח המפורט.
          </div>
        ) : (
          <>
            <ul className="mt-3 flex flex-wrap gap-2">
              {pcnCounts.map((c) => (
                <li
                  key={c.type}
                  className="rounded-xl bg-stone-50 border border-stone-200 px-3 py-2 text-xs text-stone-700"
                >
                  <b className="font-extrabold text-stone-900">{c.type}</b>
                  <span className="mx-1.5 text-stone-300">·</span>
                  {c.summary}
                  <span className="block text-stone-600 mt-0.5">{c.label}</span>
                </li>
              ))}
            </ul>

            {pcn.warnings.length > 0 && (
              <ul className="mt-3 space-y-2">
                {pcn.warnings.map((w, i) => {
                  const isError = w.level === "error";
                  const Icon = isError ? AlertCircle : AlertTriangle;
                  const href = w.source === "document" ? `/documents/${w.sourceId}` : "/expenses";
                  return (
                    <li
                      key={`${w.sourceId}-${i}`}
                      className={`rounded-xl border p-3 text-sm ${
                        isError
                          ? "bg-rose-50 border-rose-200 text-rose-900"
                          : "bg-amber-50 border-amber-200 text-amber-900"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Icon
                          className={`w-4 h-4 mt-0.5 shrink-0 ${isError ? "text-rose-600" : "text-amber-600"}`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="leading-relaxed">{w.message}</p>
                          <Link
                            href={href}
                            className="no-print inline-flex items-center gap-1 mt-1 text-xs font-semibold underline hover:no-underline"
                          >
                            {w.sourceLabel}
                          </Link>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {pcn.refundPeriod && (
              <p className="mt-3 rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
                התקופה מסתיימת בהחזר, ולכן כל תשומה מופיעה בקובץ בנפרד (בלי ריכוז קופה קטנה), כפי שמע״מ דורש בדוח להחזר.
              </p>
            )}

            {pcnProblems.length > 0 && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                <p className="font-semibold">הקובץ אינו זמין להורדה:</p>
                <ul className="list-disc mt-1 pr-5 space-y-0.5">
                  {pcnProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={downloadPcn}
                disabled={pcnProblems.length > 0}
                className="no-print inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-rose-500 hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none"
              >
                <FileDown className="w-4 h-4" aria-hidden="true" />
                {pcn.warnings.some((w) => w.level === "error") ? "הורד בכל זאת" : "הורד קובץ PCN874"}
              </button>
              <a
                href="https://www.gov.il/he/service/detailed-vat-reporting"
                target="_blank"
                rel="noopener"
                className="no-print inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-orange-700 hover:underline"
              >
                לשירות דיווח מפורט באתר רשות המסים
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </div>
            {pcnProblems.length === 0 && pcn.warnings.some((w) => w.level === "error") && (
              <p className="text-xs text-rose-700 mt-2 font-semibold">
                יש שגיאות שמע״מ עשוי לדחות, מומלץ לתקן קודם
              </p>
            )}
          </>
        )}
      </section>

      {/* Itemized expenses: the periodic filing needs every expense listed,
          not just the input-VAT total. Same table skin as the invoices report. */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
          <h3 className="font-bold text-stone-900">פירוט ההוצאות בתקופה</h3>
          <div className="flex items-center gap-3">
            <span className="text-sm text-stone-500">{stats.expenseRows.length} הוצאות</span>
            {stats.expenseRows.length > 0 && (
              <button
                onClick={exportExpensesCsv}
                className="no-print inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
              >
                <Download className="w-4 h-4" />
                ייצוא Excel
              </button>
            )}
          </div>
        </div>
        {stats.expenseRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-200 p-6 text-center text-sm text-stone-500">
            אין הוצאות בתקופה שנבחרה.{" "}
            <Link href="/expenses" className="no-print text-orange-700 font-semibold hover:underline">
              להוספת הוצאה
            </Link>
          </div>
        ) : (
          <>
          {/* Phones: one compact card per expense, the table would only show
              date/supplier and hide the money behind a horizontal scroll. */}
          <ul className="sm:hidden print:hidden space-y-2">
            {stats.expenseRows.map((r) => (
              <li key={r.id} className="rounded-xl border border-stone-200 bg-white px-3.5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-stone-900 truncate">{r.supplier || "ללא ספק"}</span>
                  <span className="font-extrabold text-stone-900 tabular-nums whitespace-nowrap" dir="ltr">{formatCurrency(r.amount)}</span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-stone-500">
                  <span className="truncate">
                    <span className="tabular-nums">{formatDate(r.date)}</span>
                    {r.category ? ` · ${r.category}` : ""}
                    {r.description ? ` · ${r.description}` : ""}
                  </span>
                  <span className="tabular-nums whitespace-nowrap">מע״מ {formatCurrency(r.vat)}</span>
                </div>
              </li>
            ))}
            <li className="rounded-xl bg-orange-50 border border-orange-200 px-3.5 py-3 font-black text-stone-900">
              <div className="flex items-baseline justify-between gap-3">
                <span>סה״כ · {stats.expenseRows.length} הוצאות</span>
                <span className="tabular-nums" dir="ltr">{formatCurrency(stats.inputGross)}</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs font-semibold text-stone-600">
                <span>ללא מע״מ {formatCurrency(stats.inputBase)}</span>
                <span>מע״מ {formatCurrency(stats.inputVat)}</span>
              </div>
            </li>
          </ul>
          <div className="hidden sm:block print:block overflow-x-auto">
            <table className="gk-rtable w-full text-sm border-separate border-spacing-0 rounded-xl overflow-hidden shadow-sm">
              <thead>
                <tr className="bg-gradient-to-l from-orange-500 to-rose-500 text-white">
                  <th className="px-4 py-3 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">תאריך</th>
                  <th className="px-4 py-3 text-xs font-extrabold tracking-wide text-right whitespace-nowrap border-l border-white/20">ספק</th>
                  <th className="px-4 py-3 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">קטגוריה</th>
                  <th className="px-4 py-3 text-xs font-extrabold tracking-wide text-right border-l border-white/20">תיאור</th>
                  <th className="px-4 py-3 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">ללא מע״מ</th>
                  <th className="px-4 py-3 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">מע״מ</th>
                  <th className="px-4 py-3 text-xs font-extrabold tracking-wide text-center whitespace-nowrap">סכום כולל</th>
                </tr>
              </thead>
              <tbody>
                {stats.expenseRows.map((r, i) => (
                  <tr key={r.id} className={`${i % 2 ? "bg-orange-50/40" : "bg-white"} hover:bg-amber-50/40 transition-colors`}>
                    <td className="px-4 py-3 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{formatDate(r.date)}</td>
                    <td className="px-4 py-3 text-right align-middle font-semibold text-stone-900 border-b border-l border-stone-200">{r.supplier || <span className="text-stone-300">-</span>}</td>
                    <td className="px-4 py-3 text-center align-middle whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{r.category || <span className="text-stone-300">-</span>}</td>
                    <td className="px-4 py-3 text-right align-middle text-stone-600 border-b border-l border-stone-200 max-w-[22rem]">{r.description || <span className="text-stone-300">-</span>}</td>
                    <td className="px-4 py-3 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{formatCurrency(r.net)}</td>
                    <td className="px-4 py-3 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{formatCurrency(r.vat)}</td>
                    <td className="px-4 py-3 text-center align-middle tabular-nums font-extrabold text-stone-900 whitespace-nowrap border-b border-stone-200">{formatCurrency(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-orange-50 text-stone-900 font-black">
                  <td className="px-4 py-3.5 text-center border-t-2 border-l border-orange-200" colSpan={4}>סה״כ · {stats.expenseRows.length} הוצאות</td>
                  <td className="px-4 py-3.5 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrency(stats.inputBase)}</td>
                  <td className="px-4 py-3.5 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrency(stats.inputVat)}</td>
                  <td className="px-4 py-3.5 text-center tabular-nums whitespace-nowrap border-t-2 border-orange-200">{formatCurrency(stats.inputGross)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          </>
        )}
      </div>

      <div className="text-xs text-stone-600 leading-relaxed border-t border-orange-100 pt-3">
        <strong className="text-stone-700">איך מחושב:</strong>{" "}
        מע״מ עסקאות = ה-מע״מ שנגבה מהלקוחות בחשבוניות מס וחשבוניות מס/קבלה (ללא טיוטות וביטולים, חשבוניות זיכוי מקטינות).
        מע״מ תשומות = שדה &quot;מתוכו מע״מ&quot; שהזנת על כל הוצאה. הסיכום אינו תחליף לדוח טופס 102 אצל רואה החשבון,
        משמש לבקרה והכנה בלבד.
      </div>
    </div>
  );
}

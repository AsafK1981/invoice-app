"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { Printer, ArrowRight } from "lucide-react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { useBusiness } from "@/lib/business-store";
import { formatCurrency, formatDate } from "@/lib/format";
import { todayInIsrael } from "@/lib/date";
import { DOCUMENT_TYPE_LABELS, BUSINESS_TYPE_LABELS, isCountableRevenue } from "@/lib/types";

const MONTH_NAMES = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

export default function YearJournalPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: yearStr } = use(params);
  const year = parseInt(yearStr, 10);

  const { documents, ready: docsReady } = useDocuments();
  const { items: expenses, ready: expReady } = useExpenses();
  const { business, ready: bizReady } = useBusiness();

  const data = useMemo(() => {
    const prefix = `${year}-`;
    // Income book counts only real revenue documents: quotes/proformas are
    // pre-payment (not revenue), and a doc already converted into another
    // (convertedToId set) is skipped so its revenue isn't double-counted with
    // the target receipt. Credit notes stay in (stored negative → subtract).
    const incomeDocs = documents
      .filter((d) => d.status === "paid" && isCountableRevenue(d) && d.date.startsWith(prefix))
      .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
    const yearExpenses = expenses
      .filter((e) => e.date.startsWith(prefix))
      .sort((a, b) => a.date.localeCompare(b.date));

    const incomeByMonth = new Array(12).fill(0) as number[];
    const incomeVatByMonth = new Array(12).fill(0) as number[];
    const expenseByMonth = new Array(12).fill(0) as number[];

    for (const d of incomeDocs) {
      const m = parseInt(d.date.slice(5, 7), 10) - 1;
      if (m >= 0 && m < 12) {
        incomeByMonth[m] += (d.totalIls ?? d.total);
        // Net of credit notes, not absolute: a credit note reduces the
        // transaction and its VAT, and incomeByMonth above is already
        // netted the same way (credit notes are stored ALREADY NEGATIVE on
        // save). Math.abs() here would add a refund's VAT back in as if it
        // were still collected.
        incomeVatByMonth[m] += (d.vatIls ?? d.vat);
      }
    }
    for (const e of yearExpenses) {
      const m = parseInt(e.date.slice(5, 7), 10) - 1;
      if (m >= 0 && m < 12) {
        expenseByMonth[m] += e.amount;
      }
    }

    const totalIncome = incomeDocs.reduce((s, d) => s + (d.totalIls ?? d.total), 0);
    // Net of credit notes (see incomeVatByMonth above): also needed so
    // `totalIncome - totalIncomeVat` (used for the "סכום ללא מע"מ" row
    // below) stays consistent when a credit note is present in the period.
    const totalIncomeVat = incomeDocs.reduce((s, d) => s + (d.vatIls ?? d.vat), 0);
    const totalExpenses = yearExpenses.reduce((s, e) => s + e.amount, 0);

    return {
      incomeDocs,
      yearExpenses,
      incomeByMonth,
      incomeVatByMonth,
      expenseByMonth,
      totalIncome,
      totalIncomeVat,
      totalExpenses,
      profit: totalIncome - totalExpenses,
    };
  }, [documents, expenses, year]);

  if (!docsReady || !expReady || !bizReady) {
    return (
      <div className="text-center py-16 text-stone-600">טוען...</div>
    );
  }

  if (Number.isNaN(year) || year < 2000 || year > 2100) {
    return (
      <div className="card-soft p-8 text-center">
        <p className="text-stone-700">שנה לא תקינה</p>
        <Link href="/reports" className="text-orange-600 mt-4 inline-block">
          חזרה לדו״חות
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 1.5cm 1cm;
          }
          html, body {
            background: white !important;
          }
          .no-print, nav, aside, [role="navigation"] {
            display: none !important;
          }
          .journal-section {
            break-inside: avoid;
          }
          .journal-section + .journal-section {
            page-break-before: always;
          }
          table {
            font-size: 9pt;
          }
        }
      `}</style>

      <div className="no-print flex items-center justify-between flex-wrap gap-3">
        <Link
          href="/reports"
          className="inline-flex items-center gap-2 text-sm text-stone-700 hover:text-stone-900"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לדו״חות
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <DownloadPdfButton
            filename={`יומן-הוצאות-והכנסות-${year}-${business.name}`}
            className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-5 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50 transition-all"
            iconClassName="w-4 h-4"
          />
          <button
            onClick={() => {
              const original = document.title;
              document.title = `יומן הוצאות והכנסות ${year} - ${business.name}`;
              try {
                window.print();
              } finally {
                document.title = original;
              }
            }}
            className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-orange-700 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all"
          >
            <Printer className="w-4 h-4" />
            הדפס
          </button>
        </div>
      </div>

      <div className="gk-paper bg-white rounded-2xl shadow-sm border border-orange-100 p-6 sm:p-8 print:shadow-none print:border-0 print:rounded-none print:p-0">
        <header className="text-center pb-6 mb-6 border-b border-stone-200">
          <h1 className="text-2xl font-bold text-stone-900">
            יומן הוצאות והכנסות
          </h1>
          <p className="text-stone-700 mt-1">שנת מס {year}</p>
          <div className="mt-4 text-sm text-stone-700 space-y-0.5">
            <p className="font-semibold text-stone-900">{business.name || "-"}</p>
            <p>
              {BUSINESS_TYPE_LABELS[business.businessType]} · ע.מ {business.taxId || "-"}
            </p>
            {business.address && <p>{business.address}</p>}
          </div>
        </header>

        <section className="journal-section">
          <h2 className="text-lg font-bold text-stone-900 mb-3">
            ספר הכנסות ({data.incomeDocs.length})
          </h2>
          {data.incomeDocs.length === 0 ? (
            <p className="text-sm text-stone-500 py-6 text-center">
              אין הכנסות לשנת {year}
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-stone-100">
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">תאריך</th>
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">סוג מסמך</th>
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">מס׳</th>
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">לקוח</th>
                  <th className="text-left px-3 py-2 border border-stone-300 font-semibold text-stone-700">סכום ללא מע״מ</th>
                  <th className="text-left px-3 py-2 border border-stone-300 font-semibold text-stone-700">מע״מ</th>
                  <th className="text-left px-3 py-2 border border-stone-300 font-semibold text-stone-700">סה״כ</th>
                </tr>
              </thead>
              <tbody>
                {data.incomeDocs.map((d) => (
                  <tr key={d.id} className="even:bg-stone-50/60">
                    <td className="px-3 py-1.5 border border-stone-200">{formatDate(d.date)}</td>
                    <td className="px-3 py-1.5 border border-stone-200">{DOCUMENT_TYPE_LABELS[d.type]}</td>
                    <td className="px-3 py-1.5 border border-stone-200 font-mono">{d.number}</td>
                    <td className="px-3 py-1.5 border border-stone-200">{d.clientName}</td>
                    <td className="px-3 py-1.5 border border-stone-200 text-left font-mono">{formatCurrency(d.subtotalIls ?? d.subtotal)}</td>
                    {/* Net (no Math.abs): a credit-note row's subtotal column
                        above already shows negative, so a positive VAT here
                        would make the row inconsistent with itself and with
                        the netted totals row below. */}
                    <td className="px-3 py-1.5 border border-stone-200 text-left font-mono">{formatCurrency(d.vatIls ?? d.vat)}</td>
                    <td className="px-3 py-1.5 border border-stone-200 text-left font-mono font-semibold">{formatCurrency(d.totalIls ?? d.total)}</td>
                  </tr>
                ))}
                <tr className="bg-emerald-50 font-bold">
                  <td className="px-3 py-2 border border-stone-300" colSpan={4}>סה״כ הכנסות</td>
                  <td className="px-3 py-2 border border-stone-300 text-left font-mono">{formatCurrency(data.totalIncome - data.totalIncomeVat)}</td>
                  <td className="px-3 py-2 border border-stone-300 text-left font-mono">{formatCurrency(data.totalIncomeVat)}</td>
                  <td className="px-3 py-2 border border-stone-300 text-left font-mono">{formatCurrency(data.totalIncome)}</td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </section>

        <section className="journal-section mt-10">
          <h2 className="text-lg font-bold text-stone-900 mb-3">
            ספר הוצאות ({data.yearExpenses.length})
          </h2>
          {data.yearExpenses.length === 0 ? (
            <p className="text-sm text-stone-500 py-6 text-center">
              אין הוצאות לשנת {year}
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-stone-100">
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">תאריך</th>
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">ספק</th>
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">קטגוריה</th>
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">תיאור</th>
                  <th className="text-left px-3 py-2 border border-stone-300 font-semibold text-stone-700">מע״מ</th>
                  <th className="text-left px-3 py-2 border border-stone-300 font-semibold text-stone-700">סכום</th>
                </tr>
              </thead>
              <tbody>
                {data.yearExpenses.map((e) => (
                  <tr key={e.id} className="even:bg-stone-50/60">
                    <td className="px-3 py-1.5 border border-stone-200">{formatDate(e.date)}</td>
                    <td className="px-3 py-1.5 border border-stone-200">{e.supplier}</td>
                    <td className="px-3 py-1.5 border border-stone-200">{e.category}</td>
                    <td className="px-3 py-1.5 border border-stone-200 text-stone-600">{e.description || "-"}</td>
                    <td className="px-3 py-1.5 border border-stone-200 text-left font-mono">{formatCurrency(e.vatAmount || 0)}</td>
                    <td className="px-3 py-1.5 border border-stone-200 text-left font-mono font-semibold">{formatCurrency(e.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-rose-50 font-bold">
                  <td className="px-3 py-2 border border-stone-300" colSpan={5}>סה״כ הוצאות</td>
                  <td className="px-3 py-2 border border-stone-300 text-left font-mono">{formatCurrency(data.totalExpenses)}</td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </section>

        <section className="journal-section mt-10">
          <h2 className="text-lg font-bold text-stone-900 mb-3">סיכום חודשי</h2>
          <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-stone-100">
                <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">חודש</th>
                <th className="text-left px-3 py-2 border border-stone-300 font-semibold text-stone-700">הכנסות</th>
                <th className="text-left px-3 py-2 border border-stone-300 font-semibold text-stone-700">הוצאות</th>
                <th className="text-left px-3 py-2 border border-stone-300 font-semibold text-stone-700">רווח</th>
              </tr>
            </thead>
            <tbody>
              {MONTH_NAMES.map((name, idx) => {
                const inc = data.incomeByMonth[idx];
                const exp = data.expenseByMonth[idx];
                if (inc === 0 && exp === 0) return null;
                return (
                  <tr key={idx} className="even:bg-stone-50/60">
                    <td className="px-3 py-1.5 border border-stone-200">{name}</td>
                    <td className="px-3 py-1.5 border border-stone-200 text-left font-mono text-emerald-700">{formatCurrency(inc)}</td>
                    <td className="px-3 py-1.5 border border-stone-200 text-left font-mono text-rose-700">{formatCurrency(exp)}</td>
                    <td className="px-3 py-1.5 border border-stone-200 text-left font-mono font-semibold">{formatCurrency(inc - exp)}</td>
                  </tr>
                );
              })}
              <tr className="bg-orange-100 font-bold">
                <td className="px-3 py-2 border border-stone-300">סה״כ שנתי</td>
                <td className="px-3 py-2 border border-stone-300 text-left font-mono">{formatCurrency(data.totalIncome)}</td>
                <td className="px-3 py-2 border border-stone-300 text-left font-mono">{formatCurrency(data.totalExpenses)}</td>
                <td className="px-3 py-2 border border-stone-300 text-left font-mono">{formatCurrency(data.profit)}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </section>

        <footer className="text-xs text-stone-500 text-center mt-8 pt-4 border-t border-stone-200">
          הופק ב-{formatDate(todayInIsrael())} ממערכת חשבונית ידידותית
        </footer>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Wallet, Printer } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { InvoiceDocument, Expense } from "@/lib/types";

interface Props {
  documents: InvoiceDocument[];
  expenses: Expense[];
}

interface YearRow {
  year: number;
  income: number;
  expenses: number;
  profit: number;
  documentsCount: number;
  expensesCount: number;
}

/**
 * הצהרת הון — Statement of Capital. Filed every ~3-5 years by request
 * of the Tax Authority; compares assets at start of period vs end and
 * reconciles the diff against business profits + personal spending.
 *
 * This component generates a multi-year income/expense table that can
 * be attached to the declaration, or used to fill the "annual business
 * profits" section of the form.
 */
export function CapitalDeclarationReport({ documents, expenses }: Props) {
  const currentYear = new Date().getFullYear();
  const [fromYear, setFromYear] = useState<number>(currentYear - 4);
  const [toYear, setToYear] = useState<number>(currentYear);

  const rows = useMemo<YearRow[]>(() => {
    const result: YearRow[] = [];
    for (let y = fromYear; y <= toYear; y++) {
      const yearDocs = documents.filter(
        (d) => d.status === "paid" && d.date.startsWith(`${y}-`)
      );
      const yearExpenses = expenses.filter((e) => e.date.startsWith(`${y}-`));
      const income = yearDocs.reduce((s, d) => s + d.total, 0);
      const totalExpenses = yearExpenses.reduce((s, e) => s + e.amount, 0);
      result.push({
        year: y,
        income,
        expenses: totalExpenses,
        profit: income - totalExpenses,
        documentsCount: yearDocs.length,
        expensesCount: yearExpenses.length,
      });
    }
    return result;
  }, [documents, expenses, fromYear, toYear]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        income: acc.income + r.income,
        expenses: acc.expenses + r.expenses,
        profit: acc.profit + r.profit,
        documentsCount: acc.documentsCount + r.documentsCount,
        expensesCount: acc.expensesCount + r.expensesCount,
      }),
      { income: 0, expenses: 0, profit: 0, documentsCount: 0, expensesCount: 0 }
    );
  }, [rows]);

  const yearOptions: number[] = [];
  for (let y = currentYear; y >= currentYear - 10; y--) yearOptions.push(y);

  return (
    <div className="card-soft p-6 print:shadow-none">
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-purple-500" />
            הכנה להצהרת הון
          </h2>
          <p className="text-sm text-stone-700 mt-1">
            סיכום רב-שנתי של הכנסות והוצאות העסק — לצירוף לטופס ההצהרה או לשימוש רואה החשבון.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="no-print inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
        >
          <Printer className="w-4 h-4" />
          הדפס
        </button>
      </div>

      <div className="no-print flex flex-wrap items-center gap-3 mb-5 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-stone-500">משנת:</span>
          <select
            value={fromYear}
            onChange={(e) => {
              const y = parseInt(e.target.value, 10);
              setFromYear(y);
              if (y > toYear) setToYear(y);
            }}
            className="input-warm py-1.5 px-3 text-sm w-auto"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-stone-500">עד שנת:</span>
          <select
            value={toYear}
            onChange={(e) => {
              const y = parseInt(e.target.value, 10);
              setToYear(y);
              if (y < fromYear) setFromYear(y);
            }}
            className="input-warm py-1.5 px-3 text-sm w-auto"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <span className="text-stone-500 text-xs">
          ({toYear - fromYear + 1} שנים)
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-purple-100">
        <table className="w-full text-sm">
          <thead className="bg-purple-50 text-stone-700">
            <tr>
              <th className="text-right px-4 py-3 font-semibold">שנה</th>
              <th className="text-left px-4 py-3 font-semibold">הכנסות</th>
              <th className="text-left px-4 py-3 font-semibold">הוצאות</th>
              <th className="text-left px-4 py-3 font-semibold">רווח נקי</th>
              <th className="text-left px-4 py-3 font-semibold text-stone-500 hidden md:table-cell">
                מסמכים / הוצאות
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={r.year}
                className={`border-t border-purple-50 ${idx % 2 === 0 ? "bg-white" : "bg-purple-50/30"}`}
              >
                <td className="px-4 py-3 font-semibold text-stone-900">{r.year}</td>
                <td className="px-4 py-3 text-left text-emerald-700 font-semibold tabular-nums">
                  {formatCurrency(r.income)}
                </td>
                <td className="px-4 py-3 text-left text-rose-700 font-semibold tabular-nums">
                  {formatCurrency(r.expenses)}
                </td>
                <td className="px-4 py-3 text-left font-bold text-stone-900 tabular-nums">
                  {formatCurrency(r.profit)}
                </td>
                <td className="px-4 py-3 text-left text-xs text-stone-500 hidden md:table-cell tabular-nums">
                  {r.documentsCount} / {r.expensesCount}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-purple-200 bg-purple-100/60">
              <td className="px-4 py-3 font-bold text-stone-900">סה״כ</td>
              <td className="px-4 py-3 text-left font-bold text-emerald-700 tabular-nums">
                {formatCurrency(totals.income)}
              </td>
              <td className="px-4 py-3 text-left font-bold text-rose-700 tabular-nums">
                {formatCurrency(totals.expenses)}
              </td>
              <td className="px-4 py-3 text-left font-bold text-stone-900 tabular-nums">
                {formatCurrency(totals.profit)}
              </td>
              <td className="px-4 py-3 text-left text-xs text-stone-600 hidden md:table-cell tabular-nums">
                {totals.documentsCount} / {totals.expensesCount}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
          <div className="text-xs text-emerald-900">ממוצע הכנסה שנתי</div>
          <div className="text-lg font-bold text-emerald-900 mt-0.5">
            {formatCurrency(rows.length > 0 ? totals.income / rows.length : 0)}
          </div>
        </div>
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3">
          <div className="text-xs text-rose-900">ממוצע הוצאה שנתי</div>
          <div className="text-lg font-bold text-rose-900 mt-0.5">
            {formatCurrency(rows.length > 0 ? totals.expenses / rows.length : 0)}
          </div>
        </div>
        <div className="rounded-xl bg-stone-50 border border-stone-200 p-3">
          <div className="text-xs text-stone-700">ממוצע רווח שנתי</div>
          <div className="text-lg font-bold text-stone-900 mt-0.5">
            {formatCurrency(rows.length > 0 ? totals.profit / rows.length : 0)}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-purple-50 border border-purple-200 p-3 text-xs text-purple-900">
        <strong>שים לב:</strong> הצהרת הון משווה את ההון בתחילת תקופה לסופה — היא דורשת גם נתוני
        נכסים אישיים (חשבונות בנק, נדל״ן, רכבים, חסכונות) שאינם במערכת. הטבלה הזו מספקת את חלק
        הרווח השוטף מהעסק; את שאר הסעיפים יש להוסיף בנפרד.
      </div>
    </div>
  );
}

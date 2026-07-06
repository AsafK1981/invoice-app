"use client";

import { useMemo } from "react";
import { Printer, FileText, Users, Tag, TrendingUp, TrendingDown } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import {
  DOCUMENT_TYPE_LABELS,
  isCountableRevenue,
  type InvoiceDocument,
  type Expense,
} from "@/lib/types";

interface Props {
  year: number;
  documents: InvoiceDocument[];
  expenses: Expense[];
  /** All-time documents/expenses for prior-year comparison */
  allDocuments: InvoiceDocument[];
  allExpenses: Expense[];
}

export function TaxYearDetail({ year, documents, expenses, allDocuments, allExpenses }: Props) {
  const stats = useMemo(() => {
    // Count only real revenue documents: exclude price quotes / proformas and
    // any doc already converted into another (its revenue lives in the target,
    // so counting both double-counts). Credit notes stay in (stored negative,
    // so they subtract). Status filter (paid) is unchanged.
    const paid = documents.filter((d) => d.status === "paid" && isCountableRevenue(d));
    const totalIncome = paid.reduce((s, d) => s + (d.totalIls ?? d.total), 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const totalVat = paid.reduce((s, d) => s + Math.abs(d.vatIls ?? d.vat), 0);

    // Income by document type
    const incomeByType = new Map<string, { count: number; total: number }>();
    for (const d of paid) {
      const cur = incomeByType.get(d.type) || { count: 0, total: 0 };
      cur.count++;
      cur.total += (d.totalIls ?? d.total);
      incomeByType.set(d.type, cur);
    }

    // Expenses by category, sorted desc
    const expensesByCategory = new Map<string, { count: number; total: number }>();
    for (const e of expenses) {
      const cur = expensesByCategory.get(e.category) || { count: 0, total: 0 };
      cur.count++;
      cur.total += e.amount;
      expensesByCategory.set(e.category, cur);
    }
    const sortedExpenseCats = Array.from(expensesByCategory.entries()).sort(
      (a, b) => b[1].total - a[1].total
    );

    // Top 5 clients by income
    const incomeByClient = new Map<string, { name: string; count: number; total: number }>();
    for (const d of paid) {
      const cur = incomeByClient.get(d.clientName) || { name: d.clientName, count: 0, total: 0 };
      cur.count++;
      cur.total += (d.totalIls ?? d.total);
      incomeByClient.set(d.clientName, cur);
    }
    const topClients = Array.from(incomeByClient.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Prior year comparison
    const priorYear = year - 1;
    const priorPaid = allDocuments.filter(
      (d) => d.status === "paid" && isCountableRevenue(d) && d.date.startsWith(`${priorYear}-`)
    );
    const priorIncome = priorPaid.reduce((s, d) => s + (d.totalIls ?? d.total), 0);
    const priorExpensesTotal = allExpenses
      .filter((e) => e.date.startsWith(`${priorYear}-`))
      .reduce((s, e) => s + e.amount, 0);

    // End-of-year projection — only meaningful when looking at the
    // current year mid-stride. Extrapolate linearly from days-elapsed.
    const now = new Date();
    const isCurrentYear = year === now.getFullYear();
    let projection: { income: number; expenses: number; profit: number; daysElapsed: number; daysInYear: number } | null = null;
    if (isCurrentYear) {
      const yearStart = new Date(year, 0, 1).getTime();
      const yearEnd = new Date(year + 1, 0, 1).getTime();
      const daysInYear = Math.round((yearEnd - yearStart) / 86_400_000);
      const daysElapsed = Math.max(
        1,
        Math.round((now.getTime() - yearStart) / 86_400_000),
      );
      const ratio = daysInYear / daysElapsed;
      // Only show if we have at least 30 days and we're not near year-end.
      if (daysElapsed >= 30 && daysElapsed < daysInYear - 14) {
        projection = {
          income: totalIncome * ratio,
          expenses: totalExpenses * ratio,
          profit: (totalIncome - totalExpenses) * ratio,
          daysElapsed,
          daysInYear,
        };
      }
    }

    return {
      totalIncome,
      totalExpenses,
      totalVat,
      profit: totalIncome - totalExpenses,
      incomeByType: Array.from(incomeByType.entries()),
      sortedExpenseCats,
      topClients,
      priorIncome,
      priorExpensesTotal,
      priorProfit: priorIncome - priorExpensesTotal,
      paidCount: paid.length,
      hasPriorData: priorIncome > 0 || priorExpensesTotal > 0,
      projection,
    };
  }, [documents, expenses, allDocuments, allExpenses, year]);

  function deltaPct(current: number, prior: number): { pct: number; up: boolean } | null {
    if (prior === 0) return null;
    const pct = ((current - prior) / Math.abs(prior)) * 100;
    return { pct: Math.round(pct), up: pct >= 0 };
  }

  const incomeDelta = deltaPct(stats.totalIncome, stats.priorIncome);
  const expenseDelta = deltaPct(stats.totalExpenses, stats.priorExpensesTotal);
  const profitDelta = deltaPct(stats.profit, stats.priorProfit);

  return (
    <div className="card-soft p-6 print:shadow-none">
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-stone-900">סיכום שנתי לדיווח · {year}</h2>
          <p className="text-sm text-stone-700 mt-1">
            כל המספרים שצריך למילוי הדוח השנתי במקום אחד. ניתן להדפיס.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="no-print inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
        >
          <Printer className="w-4 h-4" />
          הדפס סיכום
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <DeltaCard
          label="הכנסות שנתיות"
          value={stats.totalIncome}
          delta={incomeDelta}
          good={(d) => d.up}
          icon={TrendingUp}
        />
        <DeltaCard
          label="הוצאות שנתיות"
          value={stats.totalExpenses}
          delta={expenseDelta}
          good={(d) => !d.up}
          icon={TrendingDown}
        />
        <DeltaCard
          label="רווח לפני מס"
          value={stats.profit}
          delta={profitDelta}
          good={(d) => d.up}
          icon={TrendingUp}
        />
      </div>

      {stats.totalVat > 0 && (
        <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4 mb-6">
          <p className="text-sm text-blue-900">
            <strong>מע״מ שנגבה:</strong> {formatCurrency(stats.totalVat)} — ייתכן ויש להעביר
            לרשות המסים בדיווח התקופתי.
          </p>
        </div>
      )}

      {stats.projection && (
        <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <p className="text-sm text-stone-800">
              <strong>תחזית לסוף שנה</strong> (לפי קצב נוכחי · יום {stats.projection.daysElapsed} מתוך{" "}
              {stats.projection.daysInYear})
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-stone-600">צפי הכנסות</div>
              <div className="text-lg font-bold text-emerald-700 tabular-nums">
                {formatCurrency(stats.projection.income)}
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-600">צפי הוצאות</div>
              <div className="text-lg font-bold text-rose-700 tabular-nums">
                {formatCurrency(stats.projection.expenses)}
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-600">צפי רווח נקי</div>
              <div className="text-lg font-bold text-stone-900 tabular-nums">
                {formatCurrency(stats.projection.profit)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <h3 className="font-semibold text-stone-900 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-orange-500" />
            הכנסות לפי סוג מסמך
          </h3>
          <ul className="space-y-2">
            {stats.incomeByType.length === 0 ? (
              <li className="text-sm text-stone-500 italic">אין הכנסות לתקופה זו</li>
            ) : (
              stats.incomeByType.map(([type, data]) => (
                <li
                  key={type}
                  className="flex items-center justify-between py-2 px-3 rounded-xl bg-emerald-50/60"
                >
                  <span className="text-sm text-stone-800">
                    {DOCUMENT_TYPE_LABELS[type as keyof typeof DOCUMENT_TYPE_LABELS]}{" "}
                    <span className="text-xs text-stone-500">({data.count})</span>
                  </span>
                  <span className="text-sm font-semibold text-stone-900">
                    {formatCurrency(data.total)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div>
          <h3 className="font-semibold text-stone-900 mb-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-rose-500" />
            הוצאות לפי קטגוריה
          </h3>
          <ul className="space-y-2">
            {stats.sortedExpenseCats.length === 0 ? (
              <li className="text-sm text-stone-500 italic">אין הוצאות לתקופה זו</li>
            ) : (
              stats.sortedExpenseCats.map(([cat, data]) => {
                const pct =
                  stats.totalExpenses > 0
                    ? Math.round((data.total / stats.totalExpenses) * 100)
                    : 0;
                return (
                  <li
                    key={cat}
                    className="flex items-center justify-between py-2 px-3 rounded-xl bg-rose-50/60"
                  >
                    <span className="text-sm text-stone-800">
                      {cat}{" "}
                      <span className="text-xs text-stone-500">
                        ({data.count} · {pct}%)
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-stone-900">
                      {formatCurrency(data.total)}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="font-semibold text-stone-900 mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-orange-500" />
          חמשת הלקוחות הגדולים
        </h3>
        {stats.topClients.length === 0 ? (
          <p className="text-sm text-stone-500 italic">אין נתונים</p>
        ) : (
          <ul className="space-y-2">
            {stats.topClients.map((c, idx) => {
              const pct =
                stats.totalIncome > 0 ? Math.round((c.total / stats.totalIncome) * 100) : 0;
              return (
                <li
                  key={c.name}
                  className="flex items-center justify-between py-2 px-3 rounded-xl bg-orange-50/40"
                >
                  <span className="text-sm text-stone-800">
                    <span className="text-stone-500 font-mono ml-1">{idx + 1}.</span>
                    {c.name}{" "}
                    <span className="text-xs text-stone-500">
                      ({c.count} מסמכים · {pct}%)
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-stone-900">
                    {formatCurrency(c.total)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-6 pt-5 border-t border-orange-100 text-xs text-stone-500">
        סיכום זה אינו תחליף לייעוץ של רואה חשבון. נתונים מבוססים על
        {" "}
        {stats.paidCount} מסמכים ששולמו ו-{expenses.length} הוצאות שנרשמו במערכת בשנת {year}.
      </div>
    </div>
  );
}

function DeltaCard({
  label,
  value,
  delta,
  good,
  icon: Icon,
}: {
  label: string;
  value: number;
  delta: { pct: number; up: boolean } | null;
  good: (d: { pct: number; up: boolean }) => boolean;
  icon: typeof TrendingUp;
}) {
  return (
    <div className="rounded-2xl bg-stone-50 border border-stone-200 p-4">
      <div className="flex items-start justify-between mb-1">
        <span className="text-xs font-medium text-stone-600">{label}</span>
        <Icon className="w-4 h-4 text-stone-400" />
      </div>
      <div className="text-2xl font-bold text-stone-900">{formatCurrency(value)}</div>
      {delta && (
        <div
          className={`text-xs mt-1 font-medium ${
            good(delta) ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {delta.up ? "▲" : "▼"} {Math.abs(delta.pct)}% משנה קודמת
        </div>
      )}
    </div>
  );
}

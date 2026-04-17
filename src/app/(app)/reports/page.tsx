"use client";

import { TrendingUp, TrendingDown, PiggyBank, CalendarDays } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { formatCurrency } from "@/lib/format";

export default function ReportsPage() {
  const { documents } = useDocuments();
  const { items: expenses } = useExpenses();

  const paidDocs = documents.filter((d) => d.status === "paid");
  const totalIncome = paidDocs.reduce((sum, d) => sum + d.total, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const byMonth = new Map<string, { income: number; expenses: number }>();
  paidDocs.forEach((d) => {
    const m = d.date.slice(0, 7);
    const cur = byMonth.get(m) || { income: 0, expenses: 0 };
    cur.income += d.total;
    byMonth.set(m, cur);
  });
  expenses.forEach((e) => {
    const m = e.date.slice(0, 7);
    const cur = byMonth.get(m) || { income: 0, expenses: 0 };
    cur.expenses += e.amount;
    byMonth.set(m, cur);
  });

  const months = Array.from(byMonth.entries()).sort().reverse();

  const summaries = [
    {
      label: "סה״כ הכנסות",
      value: formatCurrency(totalIncome),
      icon: TrendingUp,
      gradient: "from-emerald-400 to-teal-500",
      bgGradient: "from-emerald-50 to-teal-50",
    },
    {
      label: "סה״כ הוצאות",
      value: formatCurrency(totalExpenses),
      icon: TrendingDown,
      gradient: "from-rose-400 to-pink-500",
      bgGradient: "from-rose-50 to-pink-50",
    },
    {
      label: "רווח נטו",
      value: formatCurrency(totalIncome - totalExpenses),
      icon: PiggyBank,
      gradient: "from-orange-400 to-amber-500",
      bgGradient: "from-orange-50 to-amber-50",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-sm">
            <TrendingUp className="w-5 h-5 text-white" />
          </span>
          דו״חות
        </h1>
        <p className="text-sm text-stone-700 mt-2 mr-14">סיכום פיננסי לפי תקופה</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {summaries.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className={`card-soft p-5 bg-gradient-to-br ${s.bgGradient} border-transparent`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-stone-700">{s.label}</p>
                  <p className="text-2xl font-bold mt-2 text-stone-900">{s.value}</p>
                </div>
                <div
                  className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-sm`}
                >
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card-soft overflow-hidden">
        <div className="px-6 py-4 border-b border-orange-100 flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-orange-500" />
          <h2 className="font-semibold text-stone-900">פירוט חודשי</h2>
        </div>
        <table className="w-full">
          <thead className="text-xs text-stone-700 bg-orange-50/50">
            <tr>
              <th className="text-right px-6 py-3 font-semibold">חודש</th>
              <th className="text-left px-6 py-3 font-semibold">הכנסות</th>
              <th className="text-left px-6 py-3 font-semibold">הוצאות</th>
              <th className="text-left px-6 py-3 font-semibold">רווח</th>
            </tr>
          </thead>
          <tbody>
            {months.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-16 text-center text-sm text-stone-500">
                  אין נתונים להצגה
                </td>
              </tr>
            ) : (
              months.map(([month, data]) => (
                <tr
                  key={month}
                  className="border-t border-orange-50 hover:bg-orange-50/40 transition-colors"
                >
                  <td className="px-6 py-3 text-sm font-medium text-stone-900">
                    {formatMonthLabel(month)}
                  </td>
                  <td className="px-6 py-3 text-sm text-left font-semibold text-emerald-600">
                    {formatCurrency(data.income)}
                  </td>
                  <td className="px-6 py-3 text-sm text-left font-semibold text-rose-600">
                    {formatCurrency(data.expenses)}
                  </td>
                  <td className="px-6 py-3 text-sm text-left font-bold text-stone-900">
                    {formatCurrency(data.income - data.expenses)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const names = [
    "ינואר",
    "פברואר",
    "מרץ",
    "אפריל",
    "מאי",
    "יוני",
    "יולי",
    "אוגוסט",
    "ספטמבר",
    "אוקטובר",
    "נובמבר",
    "דצמבר",
  ];
  return `${names[parseInt(m, 10) - 1]} ${year}`;
}

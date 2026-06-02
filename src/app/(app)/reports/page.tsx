"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, PiggyBank, CalendarDays, Download, FileArchive, BookOpen } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { useBusiness } from "@/lib/business-store";
import { formatCurrency } from "@/lib/format";
import { exportDocuments, exportExpenses } from "@/lib/csv-export";
import { supabase } from "@/lib/supabase";
import { TaxYearDetail } from "@/components/tax-year-detail";
import { VatPeriodReport } from "@/components/vat-period-report";
import { Form1301Helper } from "@/components/form-1301-helper";
import { CapitalDeclarationReport } from "@/components/capital-declaration-report";

type Period = string; // "all" | "2026" | "2026-Q1" | "2026-01"

interface PeriodOption {
  value: Period;
  label: string;
}

function buildPeriodOptions(years: number[]): PeriodOption[] {
  const monthNames = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
  ];
  const opts: PeriodOption[] = [{ value: "all", label: "כל הזמנים" }];
  for (const y of years) {
    opts.push({ value: String(y), label: `שנת ${y}` });
    opts.push({ value: `${y}-Q1`, label: `${y} · רבעון 1 (ינו-מרץ)` });
    opts.push({ value: `${y}-Q2`, label: `${y} · רבעון 2 (אפר-יונ)` });
    opts.push({ value: `${y}-Q3`, label: `${y} · רבעון 3 (יול-ספט)` });
    opts.push({ value: `${y}-Q4`, label: `${y} · רבעון 4 (אוק-דצמ)` });
    for (let m = 1; m <= 12; m++) {
      opts.push({
        value: `${y}-${String(m).padStart(2, "0")}`,
        label: `${monthNames[m - 1]} ${y}`,
      });
    }
  }
  return opts;
}

function periodMatches(period: Period, date: string): boolean {
  if (period === "all") return true;
  if (period.includes("-Q")) {
    const [year, q] = period.split("-Q");
    const monthsByQuarter: Record<string, string[]> = {
      "1": ["01", "02", "03"],
      "2": ["04", "05", "06"],
      "3": ["07", "08", "09"],
      "4": ["10", "11", "12"],
    };
    const months = monthsByQuarter[q];
    return months ? months.some((m) => date.startsWith(`${year}-${m}`)) : false;
  }
  return date.startsWith(period);
}

function periodLabelShort(period: Period): string {
  if (period === "all") return "all";
  return period;
}

export default function ReportsPage() {
  const { documents } = useDocuments();
  const { items: expenses } = useExpenses();
  const { business } = useBusiness();
  const [period, setPeriod] = useState<Period>("all");

  const yearsWithData = useMemo(() => {
    const set = new Set<number>();
    documents.forEach((d) => set.add(parseInt(d.date.slice(0, 4), 10)));
    expenses.forEach((e) => set.add(parseInt(e.date.slice(0, 4), 10)));
    if (set.size === 0) set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [documents, expenses]);

  const periodOptions = useMemo(() => buildPeriodOptions(yearsWithData), [yearsWithData]);

  const filteredDocs = useMemo(
    () => documents.filter((d) => periodMatches(period, d.date)),
    [documents, period]
  );
  const filteredExpenses = useMemo(
    () => expenses.filter((e) => periodMatches(period, e.date)),
    [expenses, period]
  );

  const paidDocs = filteredDocs.filter((d) => d.status === "paid");
  const totalIncome = paidDocs.reduce((sum, d) => sum + d.total, 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  const byMonth = new Map<string, { income: number; expenses: number }>();
  paidDocs.forEach((d) => {
    const m = d.date.slice(0, 7);
    const cur = byMonth.get(m) || { income: 0, expenses: 0 };
    cur.income += d.total;
    byMonth.set(m, cur);
  });
  filteredExpenses.forEach((e) => {
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

  const exportSuffix = periodLabelShort(period);

  // Year detected from the selected period — used by the OPENFORMAT
  // export, which only makes sense scoped to a single tax year.
  const selectedYear = /^\d{4}/.test(period) ? parseInt(period.slice(0, 4), 10) : null;

  async function downloadUniformStructure(sample = false) {
    const year = selectedYear ?? new Date().getFullYear();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      alert("צריך להתחבר מחדש");
      return;
    }
    const qs = `year=${year}${sample ? "&sample=true" : ""}`;
    const res = await fetch(`/api/uniform-structure/export?${qs}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "שגיאה לא ידועה" }));
      alert(`ייצוא נכשל: ${err.error || res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `OPENFRMT-${business.taxId}-${year}${sample ? "-SAMPLE" : ""}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-sm">
              <TrendingUp className="w-5 h-5 text-white" />
            </span>
            דו״חות
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">סיכום פיננסי לפי תקופה</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-stone-500">תקופה:</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="input-warm py-1.5 px-3 text-sm w-auto"
            >
              {periodOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => exportDocuments(filteredDocs, exportSuffix)}
            disabled={filteredDocs.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            ייצוא מסמכים ({filteredDocs.length})
          </button>
          <button
            onClick={() => exportExpenses(filteredExpenses, exportSuffix)}
            disabled={filteredExpenses.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            ייצוא הוצאות ({filteredExpenses.length})
          </button>
          <button
            onClick={() => downloadUniformStructure(false)}
            title="ייצוא קבצי מבנה אחיד (OPENFORMAT 1.31) מהנתונים האמיתיים — לאודיט"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-purple-200 text-stone-800 hover:bg-purple-50"
          >
            <FileArchive className="w-4 h-4 text-purple-600" />
            מבנה אחיד {selectedYear ? `(${selectedYear})` : "(שנה נוכחית)"}
          </button>
          <button
            onClick={() => downloadUniformStructure(true)}
            title="ייצוא קבצי מבנה אחיד דוגמה (2500+ רשומות סינתטיות) — לסימולטור רשות המסים לצורך רישום במרשם תוכנות"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-fuchsia-200 text-stone-800 hover:bg-fuchsia-50"
          >
            <FileArchive className="w-4 h-4 text-fuchsia-600" />
            מבנה אחיד — דוגמה ({selectedYear || "שנה"})
          </button>
          {selectedYear && (
            <Link
              href={`/reports/journal/${selectedYear}`}
              title="יומן הוצאות והכנסות שנתי — מסמך מעוצב להדפסה / שמירה כ-PDF"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-emerald-200 text-stone-800 hover:bg-emerald-50"
            >
              <BookOpen className="w-4 h-4 text-emerald-600" />
              יומן שנתי ({selectedYear})
            </Link>
          )}
        </div>
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

      <VatPeriodReport business={business} documents={documents} expenses={expenses} />

      {/^\d{4}$/.test(period) && (
        <>
          <TaxYearDetail
            year={parseInt(period, 10)}
            documents={filteredDocs}
            expenses={filteredExpenses}
            allDocuments={documents}
            allExpenses={expenses}
          />
          <Form1301Helper
            year={parseInt(period, 10)}
            business={business}
            documents={filteredDocs}
            expenses={filteredExpenses}
          />
        </>
      )}

      <CapitalDeclarationReport documents={documents} expenses={expenses} />

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
                  אין נתונים לתקופה הנבחרת
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

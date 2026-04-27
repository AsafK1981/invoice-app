"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  FileQuestion,
  Plus,
  ArrowLeft,
  Sparkles,
  CalendarDays,
  Receipt,
  Users,
  PiggyBank,
} from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { useClients } from "@/lib/client-store";
import { formatCurrency } from "@/lib/format";
import { DocumentsTable } from "@/components/documents-table";
import { DashboardChart } from "@/components/dashboard-chart";
import { TopClients } from "@/components/top-clients";
import { ExpenseCategoriesChart } from "@/components/expense-categories-chart";

type DateRange = "this_month" | "last_3_months" | "this_year" | "all_time";

const RANGE_LABELS: Record<DateRange, string> = {
  this_month: "החודש",
  last_3_months: "3 חודשים אחרונים",
  this_year: "השנה",
  all_time: "הכל",
};

function getRangeStart(range: DateRange): string {
  const now = new Date();
  switch (range) {
    case "this_month":
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    case "last_3_months":
      const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    case "this_year":
      return `${now.getFullYear()}-01-01`;
    case "all_time":
      return "0000-01-01";
  }
}

export default function DashboardPage() {
  const { documents, ready } = useDocuments();
  const { items: expenses } = useExpenses();
  const { items: clients } = useClients();
  const [range, setRange] = useState<DateRange>("this_month");

  const stats = useMemo(() => {
    const start = getRangeStart(range);

    const inRange = documents.filter((d) => d.date >= start);
    const expensesInRange = expenses.filter((e) => e.date >= start);

    const paidDocs = inRange.filter((d) => d.status === "paid");
    const income = paidDocs.reduce((sum, d) => sum + d.total, 0);
    const expenseTotal = expensesInRange.reduce((sum, e) => sum + e.amount, 0);
    const profit = income - expenseTotal;
    const openQuotes = inRange.filter((d) => d.type === "quote" && d.status === "sent");
    const openQuotesValue = openQuotes.reduce((sum, d) => sum + d.total, 0);
    const avgInvoice = paidDocs.length > 0 ? income / paidDocs.length : 0;

    return {
      inRange,
      expensesInRange,
      income,
      expenseTotal,
      profit,
      openQuotes,
      openQuotesValue,
      avgInvoice,
      paidCount: paidDocs.length,
    };
  }, [documents, expenses, range]);

  const cards = [
    {
      label: "הכנסות",
      value: formatCurrency(stats.income),
      sub: `${stats.paidCount} ${stats.paidCount === 1 ? "מסמך" : "מסמכים"} שולמו`,
      icon: TrendingUp,
      gradient: "from-emerald-400 to-teal-500",
      bgGradient: "from-emerald-50 to-teal-50",
      iconBg: "shadow-emerald-200/50",
    },
    {
      label: "הוצאות",
      value: formatCurrency(stats.expenseTotal),
      sub: `${stats.expensesInRange.length} פעולות`,
      icon: TrendingDown,
      gradient: "from-rose-400 to-pink-500",
      bgGradient: "from-rose-50 to-pink-50",
      iconBg: "shadow-rose-200/50",
    },
    {
      label: "רווח",
      value: formatCurrency(stats.profit),
      sub: stats.income > 0 ? `${((stats.profit / stats.income) * 100).toFixed(0)}% מההכנסות` : "—",
      icon: PiggyBank,
      gradient: "from-orange-400 to-amber-500",
      bgGradient: "from-orange-50 to-amber-50",
      iconBg: "shadow-orange-200/50",
    },
    {
      label: "ממוצע למסמך",
      value: formatCurrency(stats.avgInvoice),
      sub: "לפי מסמכים שולמו",
      icon: Receipt,
      gradient: "from-violet-400 to-purple-500",
      bgGradient: "from-violet-50 to-purple-50",
      iconBg: "shadow-violet-200/50",
    },
  ];

  const secondary = [
    {
      label: "הצעות פתוחות",
      value: String(stats.openQuotes.length),
      sub: stats.openQuotesValue > 0 ? formatCurrency(stats.openQuotesValue) : "אין",
      icon: FileQuestion,
      color: "text-amber-600",
      bg: "bg-amber-50 border-amber-200",
    },
    {
      label: "סה״כ לקוחות",
      value: String(clients.length),
      sub: clients.length === 1 ? "לקוח" : "לקוחות",
      icon: Users,
      color: "text-rose-600",
      bg: "bg-rose-50 border-rose-200",
    },
    {
      label: "סה״כ מסמכים",
      value: String(stats.inRange.length),
      sub: RANGE_LABELS[range],
      icon: Wallet,
      color: "text-blue-600",
      bg: "bg-blue-50 border-blue-200",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-2">
            שלום
            <Sparkles className="w-7 h-7 text-orange-400" />
          </h1>
          <p className="text-sm text-stone-700 mt-1">סקירה מהירה של הפעילות שלך</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="card-soft p-1 flex items-center gap-1">
            {(Object.keys(RANGE_LABELS) as DateRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  range === r
                    ? "bg-gradient-to-l from-orange-500 to-rose-500 text-white shadow-sm"
                    : "text-stone-700 hover:bg-orange-50"
                }`}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
          <Link
            href="/documents/new"
            className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all duration-200"
          >
            <Plus className="w-4 h-4" />
            מסמך חדש
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className={`card-soft p-5 bg-gradient-to-br ${s.bgGradient} border-transparent hover:shadow-lg hover:-translate-y-1 animate-fade-in-up stagger-${idx + 1}`}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-700">{s.label}</p>
                  <p className="text-2xl font-bold mt-2 text-stone-900 truncate">
                    {ready ? s.value : "..."}
                  </p>
                  <p className="text-xs text-stone-600 mt-1">{s.sub}</p>
                </div>
                <div
                  className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-lg ${s.iconBg} flex-shrink-0`}
                >
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-fade-in-up stagger-5">
        {secondary.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className={`rounded-2xl border p-4 ${s.bg}`}>
              <div className="flex items-center gap-3">
                <Icon className={`w-5 h-5 ${s.color}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-stone-600">{s.label}</p>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xl font-bold ${s.color}`}>{s.value}</span>
                    <span className="text-xs text-stone-600 truncate">{s.sub}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card-soft p-6 animate-fade-in-up stagger-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-orange-500" />
            הכנסות והוצאות - 6 חודשים אחרונים
          </h2>
        </div>
        <DashboardChart documents={documents} expenses={expenses} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in-up stagger-6">
        <div className="card-soft p-6">
          <h2 className="font-semibold text-stone-900 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-rose-500" />
            לקוחות מובילים ({RANGE_LABELS[range]})
          </h2>
          <TopClients documents={stats.inRange} limit={5} />
        </div>

        <div className="card-soft p-6">
          <h2 className="font-semibold text-stone-900 mb-4 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-rose-500" />
            הוצאות לפי קטגוריה ({RANGE_LABELS[range]})
          </h2>
          <ExpenseCategoriesChart expenses={stats.expensesInRange} />
        </div>
      </div>

      <div className="card-soft overflow-hidden animate-fade-in-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-orange-100">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <span className="text-2xl">📋</span>
            מסמכים אחרונים
          </h2>
          <Link
            href="/documents"
            className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium group"
          >
            לכל המסמכים
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" />
          </Link>
        </div>
        <DocumentsTable documents={documents} limit={10} />
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  FileQuestion,
  Plus,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { formatCurrency } from "@/lib/format";
import { DocumentsTable } from "@/components/documents-table";
import { DashboardChart } from "@/components/dashboard-chart";

export default function DashboardPage() {
  const { documents, ready } = useDocuments();
  const { items: expenses } = useExpenses();

  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  const monthlyIncome = documents
    .filter((d) => d.status === "paid" && d.date.startsWith(thisMonth))
    .reduce((sum, d) => sum + d.total, 0);

  const monthlyExpenses = expenses
    .filter((e) => e.date.startsWith(thisMonth))
    .reduce((sum, e) => sum + e.amount, 0);

  const openQuotes = documents.filter((d) => d.type === "quote" && d.status === "sent");
  const profit = monthlyIncome - monthlyExpenses;

  const stats = [
    {
      label: "הכנסות החודש",
      value: formatCurrency(monthlyIncome),
      icon: TrendingUp,
      gradient: "from-emerald-400 to-teal-500",
      bgGradient: "from-emerald-50 to-teal-50",
      iconBg: "shadow-emerald-200/50",
    },
    {
      label: "הוצאות החודש",
      value: formatCurrency(monthlyExpenses),
      icon: TrendingDown,
      gradient: "from-rose-400 to-pink-500",
      bgGradient: "from-rose-50 to-pink-50",
      iconBg: "shadow-rose-200/50",
    },
    {
      label: "רווח החודש",
      value: formatCurrency(profit),
      icon: Wallet,
      gradient: "from-orange-400 to-amber-500",
      bgGradient: "from-orange-50 to-amber-50",
      iconBg: "shadow-orange-200/50",
    },
    {
      label: "הצעות פתוחות",
      value: String(openQuotes.length),
      icon: FileQuestion,
      gradient: "from-violet-400 to-purple-500",
      bgGradient: "from-violet-50 to-purple-50",
      iconBg: "shadow-violet-200/50",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-2">
            שלום
            <Sparkles className="w-7 h-7 text-orange-400" />
          </h1>
          <p className="text-sm text-stone-700 mt-1">הנה סקירה מהירה של הפעילות שלך החודש</p>
        </div>
        <Link
          href="/documents/new"
          className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          מסמך חדש
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className={`card-soft p-5 bg-gradient-to-br ${s.bgGradient} border-transparent hover:shadow-lg hover:-translate-y-1 animate-fade-in-up stagger-${idx + 1}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-stone-700">{s.label}</p>
                  <p className="text-2xl font-bold mt-2 text-stone-900 animate-fade-in">
                    {ready ? s.value : "..."}
                  </p>
                </div>
                <div
                  className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-lg ${s.iconBg}`}
                >
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card-soft p-6 animate-fade-in-up stagger-5">
        <h2 className="font-semibold text-stone-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-orange-500" />
          הכנסות והוצאות - 6 חודשים אחרונים
        </h2>
        <DashboardChart documents={documents} expenses={expenses} />
      </div>

      <div className="card-soft overflow-hidden animate-fade-in-up stagger-6">
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

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
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
  ClipboardList,
} from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { isCountableRevenue } from "@/lib/types";
import { useExpenses } from "@/lib/expense-store";
import { useClients } from "@/lib/client-store";
import { formatCurrency } from "@/lib/format";
import { useBusiness } from "@/lib/business-store";
import { useProducts } from "@/lib/product-store";
import { DocumentsTable } from "@/components/documents-table";
import { DashboardChart } from "@/components/dashboard-chart";
import { TopClients } from "@/components/top-clients";
import { QuoteAging } from "@/components/quote-aging";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { ExemptCeilingTracker } from "@/components/exempt-ceiling-tracker";
import { RecurringDueAlert } from "@/components/recurring-due-alert";
import { InvoiceProposalCard } from "@/components/invoice-proposal-card";
import { BetaBanner } from "@/components/beta-banner";

const ExpenseCategoriesChart = dynamic(
  () => import("@/components/charts-recharts").then((mod) => mod.ExpenseCategoriesChart),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center animate-pulse">
        <div className="mx-auto rounded-full bg-stone-100" style={{ width: 176, height: 176 }} />
        <div className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-5 rounded bg-stone-100" />
          ))}
        </div>
      </div>
    ),
  },
);

/**
 * The dashboard's period picker. Every option is "the last N calendar
 * months, including the current one": חודש = this month, חודשיים = this
 * month + last, and so on. One rule for all four keeps the previous-period
 * comparison honest (the N months just before those), and lets the picker
 * live INSIDE the KPI panel it drives with labels short enough to sit there.
 * Replaced החודש / 3 חודשים / השנה / הכל on 2026-08-18 at the user's request.
 */
type DateRange = "1m" | "2m" | "6m" | "12m";

const RANGE_MONTHS: Record<DateRange, number> = { "1m": 1, "2m": 2, "6m": 6, "12m": 12 };

const RANGE_LABELS: Record<DateRange, string> = {
  "1m": "חודש",
  "2m": "חודשיים",
  "6m": "חצי שנה",
  "12m": "שנה",
};

/** Hebrew name of the matching previous period, for the delta tooltips. */
const PREV_RANGE_LABELS: Record<DateRange, string> = {
  "1m": "חודש שעבר",
  "2m": "החודשיים שלפניהם",
  "6m": "חצי השנה שלפניה",
  "12m": "השנה שלפניה",
};

/** ISO date of the first day of the month `monthsBack` months before now. */
function monthStart(monthsBack: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function getRangeStart(range: DateRange): string {
  return monthStart(RANGE_MONTHS[range] - 1);
}

/**
 * The matching previous period: the same number of calendar months,
 * immediately before the current range. `end` is exclusive (the first day
 * of the current range).
 */
function getPreviousRange(range: DateRange): { start: string; end: string } {
  const n = RANGE_MONTHS[range];
  return { start: monthStart(2 * n - 1), end: monthStart(n - 1) };
}

/**
 * Compute percentage delta between current and previous, treating each
 * gracefully: null when there's no previous data to compare against,
 * +∞ when going from zero to positive (rendered as "חדש" by the UI).
 */
function calcDelta(curr: number, prev: number): { pct: number | null; mode: "up" | "down" | "flat" | "new" } {
  if (prev === 0 && curr === 0) return { pct: 0, mode: "flat" };
  if (prev === 0) return { pct: null, mode: "new" };
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.5) return { pct: 0, mode: "flat" };
  return { pct, mode: pct > 0 ? "up" : "down" };
}

export default function DashboardPage() {
  const { documents, ready } = useDocuments();
  const { items: expenses } = useExpenses();
  const { items: clients } = useClients();
  const { items: products } = useProducts();
  const { business } = useBusiness();
  const [range, setRange] = useState<DateRange>("1m");

  const stats = useMemo(() => {
    const start = getRangeStart(range);

    const inRange = documents.filter((d) => d.date >= start);
    const expensesInRange = expenses.filter((e) => e.date >= start);

    const paidDocs = inRange.filter((d) => d.status === "paid" && isCountableRevenue(d));
    const income = paidDocs.reduce((sum, d) => sum + (d.totalIls ?? d.total), 0);
    const expenseTotal = expensesInRange.reduce((sum, e) => sum + e.amount, 0);
    const profit = income - expenseTotal;
    const openQuotes = inRange.filter((d) => d.type === "quote" && d.status === "sent");
    const openQuotesValue = openQuotes.reduce((sum, d) => sum + (d.totalIls ?? d.total), 0);
    const avgInvoice = paidDocs.length > 0 ? income / paidDocs.length : 0;

    // Previous-period stats for month-over-month-style deltas.
    const prev = getPreviousRange(range);
    let prevIncome = 0;
    let prevExpense = 0;
    let prevProfit = 0;
    let prevPaidCount = 0;
    let prevAvg = 0;
    if (prev) {
      const prevDocs = documents.filter((d) => d.date >= prev.start && d.date < prev.end);
      const prevExpenses = expenses.filter((e) => e.date >= prev.start && e.date < prev.end);
      const prevPaid = prevDocs.filter((d) => d.status === "paid" && isCountableRevenue(d));
      prevIncome = prevPaid.reduce((sum, d) => sum + (d.totalIls ?? d.total), 0);
      prevExpense = prevExpenses.reduce((sum, e) => sum + e.amount, 0);
      prevProfit = prevIncome - prevExpense;
      prevPaidCount = prevPaid.length;
      prevAvg = prevPaid.length > 0 ? prevIncome / prevPaid.length : 0;
    }

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
      hasPrev: prev !== null,
      incomeDelta: calcDelta(income, prevIncome),
      expenseDelta: calcDelta(expenseTotal, prevExpense),
      profitDelta: calcDelta(profit, prevProfit),
      paidCountDelta: calcDelta(paidDocs.length, prevPaidCount),
      avgDelta: calcDelta(avgInvoice, prevAvg),
    };
  }, [documents, expenses, range]);

  /** Hebrew label for the previous period (used in tooltips on delta badges) */
  const prevLabel = PREV_RANGE_LABELS[range];

  // Build a `month=YYYY-MM` query suffix only when the dashboard is showing
  // exactly one calendar month; for other ranges the documents-table month
  // filter wouldn't match, and we'd rather show "all months" than wrong months.
  const monthQs = (() => {
    if (range !== "1m") return "";
    const now = new Date();
    return `&month=${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();

  const cards = [
    {
      label: "הכנסות",
      value: formatCurrency(stats.income),
      sub: `${stats.paidCount} ${stats.paidCount === 1 ? "מסמך" : "מסמכים"} שולמו`,
      icon: TrendingUp,
      href: `/documents?status=paid${monthQs}`,
      delta: stats.hasPrev ? stats.incomeDelta : null,
      /** Higher = better: for income, "up" is good (green) */
      higherIsBetter: true,
      tone: "emerald",
    },
    {
      label: "הוצאות",
      value: formatCurrency(stats.expenseTotal),
      sub: `${stats.expensesInRange.length} פעולות`,
      icon: TrendingDown,
      href: "/expenses",
      delta: stats.hasPrev ? stats.expenseDelta : null,
      /** Lower = better: for expenses, "down" is good (green) */
      higherIsBetter: false,
      tone: "rose",
    },
    {
      label: "רווח",
      value: formatCurrency(stats.profit),
      sub: stats.income > 0 ? `${((stats.profit / stats.income) * 100).toFixed(0)}% מההכנסות` : "-",
      icon: PiggyBank,
      href: "/reports",
      delta: stats.hasPrev ? stats.profitDelta : null,
      higherIsBetter: true,
      tone: "amber",
    },
    {
      label: "ממוצע למסמך",
      value: formatCurrency(stats.avgInvoice),
      sub: "לפי מסמכים שולמו",
      icon: Receipt,
      href: `/documents?status=paid${monthQs}`,
      delta: stats.hasPrev ? stats.avgDelta : null,
      higherIsBetter: true,
      tone: "violet",
    },
  ];

  const secondary = [
    {
      label: "הצעות פתוחות",
      value: String(stats.openQuotes.length),
      sub:
        stats.openQuotes.length === 0
          ? "אין"
          : stats.openQuotesValue > 0
          ? formatCurrency(stats.openQuotesValue)
          : `${stats.openQuotes.length} ${stats.openQuotes.length === 1 ? "הצעה" : "הצעות"}`,
      icon: FileQuestion,
      href: "/documents?type=quote&status=sent",
      tone: "amber",
    },
    {
      label: "סה״כ לקוחות",
      value: String(clients.length),
      sub: clients.length === 1 ? "לקוח" : "לקוחות",
      icon: Users,
      href: "/clients",
      tone: "teal",
    },
    {
      label: "סה״כ מסמכים",
      value: String(stats.inRange.length),
      sub: RANGE_LABELS[range],
      icon: Wallet,
      href: `/documents${monthQs ? `?${monthQs.slice(1)}` : ""}`,
      tone: "indigo",
    },
  ];

  return (
    <div className="gk-dashboard space-y-8">
      <div className="animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-2">
            שלום
          </h1>
          <p className="text-sm text-stone-700 mt-1">סקירה מהירה של הפעילות שלך</p>
        </div>
      </div>

      {/* Primary action alone at the inline-start (right), under the title.
          See "PAGE ACTION BAR" in app-skin.css. */}
      <div className="pgbar animate-fade-in-up">
        <Link href="/documents/new" className="pgbtn pgbtn-primary pgbtn-hero">
          <Plus aria-hidden="true" />
          מסמך חדש
        </Link>
      </div>

      <BetaBanner />

      <OnboardingChecklist
        business={business}
        clients={clients}
        products={products}
        documents={documents}
      />

      <ExemptCeilingTracker business={business} documents={documents} />

      <InvoiceProposalCard />

      <RecurringDueAlert />

      {/* Empty-state hero: only when the user has zero docs at all
          (across all time). Replaces the dense KPI grid with an obvious
          "create your first" CTA. Auto-disappears the moment they
          create their first doc. */}
      {ready && documents.length === 0 && (
        <div className="card-soft p-8 bg-gradient-to-br from-orange-50 to-rose-50 border-orange-200 text-center">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-400 flex items-center justify-center shadow-lg shadow-orange-200/50 mx-auto mb-4">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-stone-900 mb-2">בואו נתחיל</h2>
          <p className="text-sm text-stone-700 mb-5 max-w-md mx-auto leading-relaxed">
            עדיין אין לך מסמכים. הפק חשבון עסקה, הצעת מחיר או קבלה ראשונה. זה לוקח דקה. הסטטיסטיקות יופיעו כאן ברגע שיהיה מה לסכם.
          </p>
          <Link
            href="/documents/new"
            className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all"
          >
            <Plus className="w-4 h-4" />
            צור מסמך ראשון
          </Link>
        </div>
      )}

      {/* The period picker sits INSIDE the panel with the four cards it
          drives (same enclosure as /reports' `.rp-period-group`): a control
          that floated in the header read as unrelated to the numbers it was
          changing. Its active state is deliberately NOT gold - gold is
          reserved for the one call to action on the page. */}
      <section className="rp-period-group" aria-label="סיכום לתקופה">
        <div className="rp-period-row">
          <span className="rp-period-label">הנתונים לתקופה - {RANGE_LABELS[range]}</span>
          <div className="dash-range" role="group" aria-label="בחירת תקופה">
            {(Object.keys(RANGE_LABELS) as DateRange[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  range === r
                    ? "bg-stone-800 text-white shadow-sm"
                    : "text-stone-700 hover:bg-stone-100"
                }`}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((s, idx) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.label}
              href={s.href}
              className={`card-soft p-5 bg-white border-[#e9e4d8] hover:shadow-lg hover:-translate-y-1 animate-fade-in-up stagger-${idx + 1} block group cursor-pointer relative`}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="gk-label text-sm font-medium text-stone-700 flex items-center gap-1">
                    {s.label}
                    <ArrowLeft className="w-3 h-3 opacity-0 group-hover:opacity-50 -translate-x-1 group-hover:translate-x-0 transition-all" />
                  </p>
                  <p className="gk-value text-2xl font-bold mt-2 truncate">
                    {ready ? s.value : "..."}
                  </p>
                  <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                    <p className="text-xs text-stone-600">{s.sub}</p>
                    {ready && s.delta && prevLabel && (
                      <DeltaBadge delta={s.delta} higherIsBetter={s.higherIsBetter} prevLabel={prevLabel} />
                    )}
                  </div>
                </div>
                {/* Feature-toned tile (Option 1); `gk-icon` stays for the
                    desktop scale-up SIZING rule only (see app-skin.css). */}
                <div className={`gk-icon ftile ftile-${s.tone} w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </Link>
          );
        })}
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-fade-in-up stagger-5">
        {secondary.map((s) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.label}
              href={s.href}
              className="rounded-2xl border p-4 hover:shadow-md hover:-translate-y-0.5 transition-all block group cursor-pointer bg-white border-[#e9e4d8]"
            >
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ftile ftile-${s.tone}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-stone-600">{s.label}</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-bold text-stone-900">{s.value}</span>
                    <span className="text-xs text-stone-600 truncate">{s.sub}</span>
                  </div>
                </div>
                <ArrowLeft
                  className="w-4 h-4 text-stone-500 opacity-0 group-hover:opacity-70 -translate-x-1 group-hover:translate-x-0 transition-all flex-shrink-0"
                />
              </div>
            </Link>
          );
        })}
      </div>

      <div className="animate-fade-in-up stagger-5">
        <QuoteAging documents={documents} />
      </div>

      <div className="card-soft p-6 animate-fade-in-up stagger-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-stone-500" />
            הכנסות והוצאות
          </h2>
        </div>
        <DashboardChart documents={documents} expenses={expenses} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in-up stagger-6">
        <div className="card-soft p-6">
          <h2 className="font-semibold text-stone-900 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-stone-500" />
            לקוחות מובילים ({RANGE_LABELS[range]})
          </h2>
          <TopClients documents={stats.inRange} limit={5} />
        </div>

        <div className="card-soft p-6">
          <h2 className="font-semibold text-stone-900 mb-4 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-stone-500" />
            הוצאות לפי קטגוריה ({RANGE_LABELS[range]})
          </h2>
          <ExpenseCategoriesChart expenses={stats.expensesInRange} />
        </div>
      </div>

      <div className="card-soft overflow-hidden animate-fade-in-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e9e4d8]">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-stone-500" />
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

/**
 * Small badge next to a KPI showing % change vs the previous period.
 * Color & icon flip based on `higherIsBetter`, for expenses, "down"
 * is the good direction so it renders orange even though the delta
 * itself is negative. The label is rendered as a tooltip so the
 * card stays uncluttered.
 */
function DeltaBadge({
  delta,
  higherIsBetter,
  prevLabel,
}: {
  delta: { pct: number | null; mode: "up" | "down" | "flat" | "new" };
  higherIsBetter: boolean;
  prevLabel: string;
}) {
  if (delta.mode === "flat") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded-md"
        title={`ללא שינוי לעומת ${prevLabel}`}
      >
        0%
      </span>
    );
  }
  if (delta.mode === "new") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded-md"
        title={`חדש לעומת ${prevLabel}`}
      >
        חדש
      </span>
    );
  }
  if (delta.pct === null) return null;

  const isPositive = delta.mode === "up";
  const isGood = higherIsBetter ? isPositive : !isPositive;
  const colorClass = isGood
    ? "text-orange-700 bg-orange-50"
    : "text-stone-600 bg-stone-100";
  const arrow = isPositive ? "↑" : "↓";
  const pctText = `${Math.abs(delta.pct).toFixed(0)}%`;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${colorClass}`}
      title={`${isPositive ? "עלייה" : "ירידה"} של ${pctText} לעומת ${prevLabel}`}
    >
      {arrow} {pctText}
    </span>
  );
}

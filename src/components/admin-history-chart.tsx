"use client";

import { useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { formatDate } from "@/lib/format";
import { ADMIN_CHART_RANGES, buildAdminChart, type AdminChartRange, type AdminDailyPoint } from "@/lib/admin-chart";

const AdminDailyChart = dynamic(
  () => import("@/components/charts-recharts").then((mod) => mod.AdminDailyChart),
  { ssr: false, loading: () => <div className="w-full h-full rounded-xl bg-stone-100 animate-pulse" /> },
);

export function AdminHistoryChart({ title, seriesLabel, daily, generatedAt, startedAt, color = "#1F232B" }: {
  title: string;
  seriesLabel: string;
  daily: AdminDailyPoint[];
  generatedAt: string;
  startedAt?: string;
  color?: string;
}) {
  const [range, setRange] = useState<AdminChartRange>("14d");
  const id = useId();
  const chart = useMemo(() => buildAdminChart(daily, range, generatedAt, startedAt), [daily, range, generatedAt, startedAt]);
  const granularityLabel = { day: "לפי יום", week: "לפי שבוע", month: "לפי חודש" }[chart.granularity];

  return (
    <section className="card-soft p-5 min-w-0" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 id={`${id}-title`} className="font-semibold text-stone-900">{title}</h2>
        <div className="flex items-center gap-2 max-w-full">
          <label htmlFor={`${id}-range`} className="text-xs text-stone-600">תקופה</label>
          <select
            id={`${id}-range`}
            aria-label={`תקופה עבור ${title}`}
            value={range}
            onChange={(event) => setRange(event.target.value as AdminChartRange)}
            className="min-h-11 min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 focus-visible:outline-2 focus-visible:outline-stone-800"
          >
            {ADMIN_CHART_RANGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 text-xs text-stone-600" aria-live="polite">
        <p><span className="font-bold text-stone-900">{chart.total.toLocaleString("he-IL")}</span> {seriesLabel} בתקופה</p>
        <p><bdi dir="ltr">{formatDate(chart.startDate)} - {formatDate(chart.endDate)}</bdi> · {granularityLabel}</p>
      </div>
      <div className="h-56" role="img" aria-label={`${title}: ${chart.total} ${seriesLabel}, ${formatDate(chart.startDate)} עד ${formatDate(chart.endDate)}, ${granularityLabel}`}>
        <AdminDailyChart data={chart.data} seriesLabel={seriesLabel} color={color} granularity={chart.granularity} />
      </div>
      {chart.total === 0 && <p className="mt-2 text-center text-xs text-stone-500">אין {seriesLabel} בתקופה שנבחרה</p>}
    </section>
  );
}

"use client";

/**
 * Coral-skin dashboard chart (recharts bar chart), split out of
 * `dashboard-chart.tsx` so it can be `next/dynamic`-loaded.
 *
 * WHY: the gold skin — the default, and what every real user sees — returns its
 * own hand-rolled SVG chart before this ever renders. Keeping the recharts
 * `BarChart` family in the dashboard's initial bundle cost 57 KB raw / 14 KB
 * gzip that nobody downloads for a reason. (recharts itself stays in the route:
 * `expense-categories-chart.tsx` renders a `PieChart` unconditionally for every
 * skin, so only the bar-chart-specific modules are saved here.)
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export type MonthDatum = { month: string; הכנסות: number; הוצאות: number };

const gridStroke = "#fed7aa";
const axisStroke = "#78716c";
const incomeFill = "#10b981";
const expenseFill = "#f43f5e";
const tooltipBg = "#fffaf5";
const tooltipBorder = "1px solid #fed7aa";

export default function CoralBarChart({ data }: { data: MonthDatum[] }) {
  return (
    <div style={{ width: "100%", height: 288 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={true} />
          <XAxis dataKey="month" stroke={axisStroke} fontSize={12} />
          <YAxis
            stroke={axisStroke}
            fontSize={12}
            tickFormatter={(v) => `₪${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: tooltipBg,
              border: tooltipBorder,
              borderRadius: "12px",
              direction: "rtl",
            }}
            formatter={(value) =>
              new Intl.NumberFormat("he-IL", {
                style: "currency",
                currency: "ILS",
                maximumFractionDigits: 0,
              }).format(Number(value) || 0)
            }
          />
          <Legend wrapperStyle={{ direction: "rtl" }} />
          <Bar dataKey="הכנסות" fill={incomeFill} radius={[8, 8, 0, 0]} />
          <Bar dataKey="הוצאות" fill={expenseFill} radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

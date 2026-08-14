"use client";

/**
 * Both recharts-backed components live in this one module on purpose.
 * ExpenseCategoriesChart (dashboard) and AdminDailyChart (admin) each used
 * to have their own `next/dynamic(() => import(...))` pointing at separate
 * files, which produced two near-identical ~321KB chunks (recharts +
 * d3-shape/d3-scale don't tree-shake cleanly, so each dynamic entry pulled
 * in the whole library on its own). Both call sites now dynamic-import
 * *this* module instead, so Turbopack builds recharts into a single shared
 * chunk that's fetched once and cached for whichever chart loads first.
 */

import { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatCurrency } from "@/lib/format";
import type { Expense } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* ExpenseCategoriesChart (dashboard)                                  */
/* ------------------------------------------------------------------ */

interface ExpenseCategoriesChartProps {
  expenses: Expense[];
}

const COLORS = [
  "#f97316", // orange
  "#f43f5e", // rose
  "#a855f7", // violet
  "#06b6d4", // cyan
  "#10b981", // emerald
  "#eab308", // yellow
  "#ec4899", // pink
  "#64748b", // slate
];

export function ExpenseCategoriesChart({ expenses }: ExpenseCategoriesChartProps) {
  const data = useMemo(() => {
    const byCategory = new Map<string, number>();
    expenses.forEach((e) => {
      byCategory.set(e.category, (byCategory.get(e.category) || 0) + e.amount);
    });
    return Array.from(byCategory.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (data.length === 0) {
    return (
      <div className="text-center py-10 text-stone-500">
        <div className="text-3xl mb-2">💸</div>
        <p className="text-sm">אין הוצאות עדיין</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
      <div className="relative" style={{ width: "100%", height: 176 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={72}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((_, idx) => (
                <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#fffaf5",
                border: "1px solid #fed7aa",
                borderRadius: "12px",
                direction: "rtl",
              }}
              formatter={(value) => formatCurrency(Number(value) || 0)}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-xs text-stone-600">סה״כ</p>
          <p className="text-base font-bold text-stone-900">{formatCurrency(total)}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        {data.slice(0, 6).map((item, idx) => {
          const pct = ((item.value / total) * 100).toFixed(0);
          return (
            <div key={item.name} className="flex items-center gap-2 text-sm">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: COLORS[idx % COLORS.length] }}
              />
              <span className="text-stone-700 truncate flex-1">{item.name}</span>
              <span className="text-stone-500 text-xs flex-shrink-0">{pct}%</span>
              <span className="text-stone-900 font-semibold text-xs flex-shrink-0 w-16 text-left">
                {formatCurrency(item.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AdminDailyChart (admin)                                             */
/* ------------------------------------------------------------------ */

interface AdminDailyChartProps {
  data: Array<{ date: string; count: number }>;
}

export function AdminDailyChart({ data }: AdminDailyChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#fed7aa" opacity={0.4} />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} reversed />
        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
        <Tooltip />
        <Line type="monotone" dataKey="count" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

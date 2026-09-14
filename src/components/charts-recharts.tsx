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
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatCurrencyWhole, formatDate } from "@/lib/format";
import type { Expense } from "@/lib/types";
import type { AdminChartPoint } from "@/lib/admin-chart";

/* ------------------------------------------------------------------ */
/* ExpenseCategoriesChart (dashboard)                                  */
/* ------------------------------------------------------------------ */

interface ExpenseCategoriesChartProps {
  expenses: Expense[];
}

/** Segment colours by rank, not by category identity: the biggest category
 * is always the one touch of brand orange, everything after it steps down
 * through ink and stone. Beyond the fifth rank every segment repeats the
 * same barely-there grey, so a long tail of small categories reads as one
 * quiet group instead of six more competing hues. */
const RANK_COLORS = ["#4A7536", "#1F232B", "#6B6560", "#9A9086", "#D2C6B7", "#E8DDD0"];
function colorForRank(idx: number): string {
  return RANK_COLORS[Math.min(idx, RANK_COLORS.length - 1)];
}

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
    <div className="space-y-4">
      <div>
        <p className="text-xs text-stone-600 mb-2">
          סה״כ <span className="font-bold text-stone-900">{formatCurrencyWhole(total)}</span>
        </p>
        <div style={{ display: "flex", height: 10, borderRadius: 3, overflow: "hidden", gap: 2 }}>
          {data.map((item, idx) => (
            <div
              key={item.name}
              style={{
                width: `${(item.value / total) * 100}%`,
                backgroundColor: colorForRank(idx),
              }}
              title={`${item.name}: ${formatCurrencyWhole(item.value)}`}
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {data.map((item, idx) => {
          const pct = ((item.value / total) * 100).toFixed(0);
          return (
            <div key={item.name} className="flex items-center gap-2 min-w-0">
              <span
                className="flex-shrink-0"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  backgroundColor: colorForRank(idx),
                }}
              />
              <span className="text-xs text-stone-700 truncate">
                {item.name} · {pct}%
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
  data: AdminChartPoint[];
  seriesLabel?: string;
  color?: string;
  granularity?: "day" | "week" | "month";
}

export function AdminDailyChart({ data, seriesLabel = "מסמכים", color = "#1F232B", granularity = "day" }: AdminDailyChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8ddd0" opacity={0.4} />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={24} interval="preserveStartEnd"
          tickFormatter={(date) => {
            const [year, month, day] = String(date).split("-");
            return granularity === "month" ? `${month}/${year}` : `${day}/${month}`;
          }} reversed />
        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={36} domain={[0, "auto"]} />
        <Tooltip
          formatter={(value) => [value, seriesLabel]}
          labelFormatter={(date, payload) => {
            const endDate: unknown = payload[0]?.payload?.endDate;
            return typeof endDate === "string" && endDate !== String(date)
              ? `${formatDate(String(date))} - ${formatDate(endDate)}`
              : formatDate(String(date));
          }}
        />
        <Line type="linear" dataKey="count" name={seriesLabel} stroke={color} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

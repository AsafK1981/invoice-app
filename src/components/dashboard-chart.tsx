"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
  ResponsiveContainer,
} from "recharts";
import { useSkin } from "@/lib/skin";
import type { InvoiceDocument, Expense } from "@/lib/types";

interface Props {
  documents: InvoiceDocument[];
  expenses: Expense[];
}

/** Compact ₪k label for value-labels above the income bars (gold skin).
 * Typed loosely to match recharts' LabelFormatter (string | number | undefined). */
function kLabel(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!n || Number.isNaN(n)) return "";
  return `₪${Math.round(n / 1000)}k`;
}

export function DashboardChart({ documents, expenses }: Props) {
  const { skin } = useSkin();
  const gold = skin === "gold";

  // Palette swaps for the gold skin. Coral values are the originals so the
  // default look is byte-for-byte unchanged.
  const gridStroke = gold ? "rgba(214,178,108,0.12)" : "#fed7aa";
  const axisStroke = gold ? "#a79f90" : "#78716c";
  const incomeFill = gold ? "url(#goldBar)" : "#10b981";
  const expenseFill = gold ? "rgba(180,150,95,0.42)" : "#f43f5e";
  const tooltipBg = gold ? "#171106" : "#fffaf5";
  const tooltipBorder = gold ? "1px solid rgba(214,178,108,0.32)" : "1px solid #fed7aa";

  const data = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const hebrewMonths = [
        "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
        "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
      ];
      months.push({ key, label: hebrewMonths[d.getMonth()] });
    }

    return months.map((m) => {
      const income = documents
        .filter((doc) => doc.status === "paid" && doc.date.startsWith(m.key))
        .reduce((sum, doc) => sum + (doc.totalIls ?? doc.total), 0);

      const monthExpenses = expenses
        .filter((e) => e.date.startsWith(m.key))
        .reduce((sum, e) => sum + e.amount, 0);

      return {
        month: m.label,
        הכנסות: income,
        הוצאות: monthExpenses,
      };
    });
  }, [documents, expenses]);

  const hasAnyData = data.some((d) => d.הכנסות > 0 || d.הוצאות > 0);

  if (!hasAnyData) {
    return (
      <div className="h-64 flex items-center justify-center text-stone-500">
        <div className="text-center">
          <div className="text-3xl mb-2">📊</div>
          <p className="text-sm">הנתונים יופיעו כאן ברגע שתתחיל להפיק מסמכים</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 288 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: gold ? 22 : 10, right: 10, left: 10, bottom: 10 }}>
          {gold && (
            <defs>
              <linearGradient id="goldBar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#d8be77" />
                <stop offset="0.5" stopColor="#be9e4e" />
                <stop offset="1" stopColor="#8f6f2a" />
              </linearGradient>
            </defs>
          )}
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={!gold} />
          <XAxis dataKey="month" stroke={axisStroke} fontSize={12} />
          <YAxis
            stroke={axisStroke}
            fontSize={12}
            tickFormatter={(v) => `₪${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            cursor={gold ? { fill: "rgba(190,158,78,0.08)" } : undefined}
            contentStyle={{
              backgroundColor: tooltipBg,
              border: tooltipBorder,
              borderRadius: "12px",
              direction: "rtl",
              color: gold ? "#e2dccd" : undefined,
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
          <Bar dataKey="הכנסות" fill={incomeFill} radius={[8, 8, 0, 0]}>
            {gold && (
              <LabelList
                dataKey="הכנסות"
                position="top"
                formatter={kLabel}
                fill="#cdb477"
                fontSize={12}
                fontWeight={700}
              />
            )}
          </Bar>
          <Bar dataKey="הוצאות" fill={expenseFill} radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

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
  ResponsiveContainer,
} from "recharts";
import type { InvoiceDocument, Expense } from "@/lib/types";

interface Props {
  documents: InvoiceDocument[];
  expenses: Expense[];
}

export function DashboardChart({ documents, expenses }: Props) {
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
        .reduce((sum, doc) => sum + doc.total, 0);

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
        <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#fed7aa" />
          <XAxis dataKey="month" stroke="#78716c" fontSize={12} />
          <YAxis
            stroke="#78716c"
            fontSize={12}
            tickFormatter={(v) => `₪${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#fffaf5",
              border: "1px solid #fed7aa",
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
          <Bar dataKey="הכנסות" fill="#10b981" radius={[8, 8, 0, 0]} />
          <Bar dataKey="הוצאות" fill="#f43f5e" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

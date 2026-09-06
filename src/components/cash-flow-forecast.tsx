"use client";

import Link from "next/link";
import { FileText, Info, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { HEBREW_MONTHS_SHORT } from "@/lib/report-period";
import { ReportsBarChart, type BarDatum } from "@/components/reports-bar-chart";
import {
  FORECAST_CONFIDENCE_LABELS,
  FORECAST_KIND_LABELS,
  type ForecastConfidence,
  type ForecastLine,
  type ForecastMonth,
  type ForecastResult,
} from "@/lib/cash-flow-forecast";

/**
 * The cash-flow forecast, rendered. All of the arithmetic lives in
 * lib/cash-flow-forecast (pure and tested); this file only decides what the
 * numbers look like, in the same visual language as the rest of /reports:
 * the KPI strip, the bar chart, and `.rpt-table` inside a scroller so the
 * columns never squeeze on a phone.
 */
export function CashFlowForecast({ result }: { result: ForecastResult }) {
  const { months, totals, potentialQuotes, assumptions } = result;

  const chartData: BarDatum[] = months.map((m) => ({
    key: m.period,
    label: HEBREW_MONTHS_SHORT[Number(m.period.slice(5, 7)) - 1],
    title: m.label,
    // A month whose credit notes outweigh its invoices would draw a bar going
    // the wrong way; the chart only knows heights, so it gets the visible part.
    income: Math.max(0, m.inflow),
    expenses: Math.max(0, m.outflow),
    active: true,
  }));

  return (
    <div className="space-y-6 rpt">
      {/* Three tiles, so the shared four-column .rpt-kpis grid would leave a
          hole; same tile, laid out in three. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <Kpi icon={TrendingUp} label="צפוי להיכנס" value={formatCurrency(totals.inflow)}>
          <span>{`${months.length} חודשים קדימה`}</span>
        </Kpi>
        <Kpi icon={TrendingDown} label="צפוי לצאת" value={formatCurrency(totals.outflow)}>
          <span>הוצאות שוטפות, מקדמות ומע״מ</span>
        </Kpi>
        <Kpi icon={Wallet} label="נטו" value={formatCurrency(totals.net)}>
          <span>{totals.net >= 0 ? "צפי חיובי" : "צפי שלילי - כדאי להיערך"}</span>
        </Kpi>
      </div>

      <section className="card-soft rpt-card" aria-label="תזרים צפוי לפי חודש">
        <div className="rpt-card-head">
          <div>
            <h2 className="rpt-h2">תזרים צפוי לפי חודש</h2>
            <p className="rpt-hint">
              {months.length > 0 ? `${months[0].label} - ${months[months.length - 1].label}` : ""}
            </p>
          </div>
          <div className="rpt-legend" aria-hidden="true">
            <span><i className="rpt-chart-dot rpt-chart-dot-income" />נכנס</span>
            <span><i className="rpt-chart-dot rpt-chart-dot-expense" />יוצא</span>
          </div>
        </div>
        <div className="rpt-card-body">
          <ReportsBarChart data={chartData} />
        </div>
      </section>

      {potentialQuotes.count > 0 && (
        <div className="card-soft p-4 flex items-start gap-3">
          <span className="rpt-icot rpt-icot-sm mt-0.5">
            <FileText aria-hidden="true" />
          </span>
          <p className="text-sm text-stone-700">
            פוטנציאל:{" "}
            <Link href="/documents" className="font-semibold text-stone-900 hover:underline">
              {potentialQuotes.count} הצעות מחיר פתוחות
            </Link>{" "}
            בסך{" "}
            <span className="font-semibold text-stone-900" dir="ltr">
              {formatCurrency(potentialQuotes.total)}
            </span>
            . לא נכללות בסכומים למעלה - הן יהפכו לכסף רק כשיאושרו.
          </p>
        </div>
      )}

      {months.map((month) => (
        <MonthTable key={month.period} month={month} />
      ))}

      {assumptions.length > 0 && (
        <section className="card-soft p-5" aria-label="הנחות התחזית">
          <h2 className="rpt-h2 flex items-center gap-2">
            <Info className="w-4 h-4 text-stone-500" aria-hidden="true" />
            הנחות
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-stone-700 list-disc pr-5">
            {assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p className="text-xs text-stone-500 mt-4">
            תחזית, לא התחייבות. היא מבוססת על המסמכים וההוצאות שרשומים באפליקציה ועל קצב
            התשלומים של הלקוחות בעבר.
          </p>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MonthTable({ month }: { month: ForecastMonth }) {
  return (
    <section className="card-soft rpt-card overflow-hidden" aria-label={`תזרים ${month.label}`}>
      <div className="rpt-card-head">
        <div>
          <h2 className="rpt-h2">{month.label}</h2>
          <p className="rpt-hint">
            נכנס <b dir="ltr">{formatCurrency(month.inflow)}</b> · יוצא{" "}
            <b dir="ltr">{formatCurrency(month.outflow)}</b>
          </p>
        </div>
        <div className="rpt-kpi-val" dir="ltr" title="נטו לחודש">
          {formatCurrency(month.net)}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="rpt-table">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>פירוט</th>
              <th>לקוח</th>
              <th>סוג</th>
              <th>ודאות</th>
              <th className="n">סכום</th>
            </tr>
          </thead>
          <tbody>
            {month.lines.length === 0 ? (
              <tr>
                <td className="rpt-empty" colSpan={6}>
                  אין תנועות צפויות בחודש הזה.
                </td>
              </tr>
            ) : (
              <>
                {month.lines.map((line, i) => (
                  <LineRow key={`${line.date}-${line.kind}-${line.documentId ?? i}`} line={line} />
                ))}
                <tr className="rpt-total">
                  <td colSpan={5}>נטו</td>
                  <td className="n" dir="ltr">
                    {formatCurrency(month.net)}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LineRow({ line }: { line: ForecastLine }) {
  return (
    <tr>
      <td>{formatDate(line.date)}</td>
      <td>
        {line.href ? (
          <Link href={line.href} className="hover:text-orange-700">
            {line.label}
          </Link>
        ) : (
          line.label
        )}
      </td>
      <td>{line.clientName || "-"}</td>
      <td>
        <Chip tone="kind">{FORECAST_KIND_LABELS[line.kind]}</Chip>
      </td>
      <td>
        <Chip tone={line.confidence}>{FORECAST_CONFIDENCE_LABELS[line.confidence]}</Chip>
      </td>
      <td className={`n ${line.amount < 0 ? "text-stone-600" : "font-semibold text-emerald-800"}`} dir="ltr">
        {formatCurrency(line.amount)}
      </td>
    </tr>
  );
}

const CHIP_TONES: Record<ForecastConfidence | "kind", string> = {
  kind: "bg-stone-100 text-stone-700",
  certain: "bg-emerald-100 text-emerald-800",
  likely: "bg-amber-100 text-amber-800",
  estimate: "bg-stone-100 text-stone-600",
};

function Chip({ tone, children }: { tone: ForecastConfidence | "kind"; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center h-5 px-2 rounded-full text-xs font-bold ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Same tile as the reports overview - one KPI, one number, one footnote. */
function Kpi({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card-soft rpt-kpi">
      <div className="rpt-kpi-lab">
        <span>{label}</span>
        <span className="rpt-icot rpt-icot-sm"><Icon aria-hidden="true" /></span>
      </div>
      <div className="rpt-kpi-val" dir="ltr">{value}</div>
      <div className="rpt-kpi-foot">{children}</div>
    </div>
  );
}

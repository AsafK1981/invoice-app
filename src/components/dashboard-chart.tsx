"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useSkin } from "@/lib/skin";
import type { InvoiceDocument, Expense } from "@/lib/types";

interface Props {
  documents: InvoiceDocument[];
  expenses: Expense[];
}

type MonthDatum = { month: string; הכנסות: number; הוצאות: number };

/** Compact ₪k label for value-labels above the income bars (gold skin).
 * Typed loosely to match recharts' LabelFormatter (string | number | undefined). */
function kLabel(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!n || Number.isNaN(n)) return "";
  return `₪${Math.round(n / 1000)}k`;
}

/** Full ILS currency (used in the gold hover tooltip — exact, not rounded to k). */
const ils = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

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

  const data = useMemo<MonthDatum[]>(() => {
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

  // Gold skin: Robinhood-style dual monotone-cubic line chart (custom SVG).
  if (gold) {
    return <GoldLineChart data={data} />;
  }

  // Coral (default) skin — unchanged recharts bar chart.
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

/* ------------------------------------------------------------------ */
/* Gold skin: custom SVG line chart                                    */
/* ------------------------------------------------------------------ */

/** Pick a "nice" y-axis ceiling + 4 equal ticks (top tick is headroom). */
function niceScale(maxVal: number): { yMax: number; ticks: number[] } {
  if (!(maxVal > 0)) {
    return { yMax: 1000, ticks: [0, 250, 500, 750, 1000] };
  }
  const step0 = (maxVal * 1.1) / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(step0)));
  const n = step0 / pow;
  const options = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  let niceN = 10;
  for (const o of options) {
    if (n <= o) {
      niceN = o;
      break;
    }
  }
  const step = niceN * pow;
  const yMax = step * 4;
  return { yMax, ticks: [0, step, step * 2, step * 3, step * 4] };
}

/** ₪ tick label for the right-side y-axis. */
function tickLabel(v: number): string {
  if (v === 0) return "₪0";
  if (v < 1000) return `₪${v}`;
  const k = v / 1000;
  return Number.isInteger(k) ? `₪${k}k` : `₪${k.toFixed(1)}k`;
}

/**
 * Fritsch–Carlson monotone cubic interpolation → smooth cubic-bezier path.
 * Returns the stroke path `d`, plus the on-screen point coordinates.
 * Ported from the approved mockup (chart-redesign.html).
 */
function monotonePath(
  vals: number[],
  xAt: (i: number) => number,
  yAt: (v: number) => number,
): { d: string; xs: number[]; ys: number[] } {
  const n = vals.length;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(xAt(i));
    ys.push(yAt(vals[i]));
  }
  if (n < 2) {
    return { d: `M${xs[0]?.toFixed(2) ?? 0},${ys[0]?.toFixed(2) ?? 0}`, xs, ys };
  }
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    dy.push(ys[i + 1] - ys[i]);
    m.push(dy[i] / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      t.push(0);
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t.push((w1 + w2) / (w1 / m[i - 1] + w2 / m[i]));
    }
  }
  t.push(m[n - 2]);
  let d = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = xs[i] + dx[i] / 3;
    const c1y = ys[i] + (t[i] * dx[i]) / 3;
    const c2x = xs[i + 1] - dx[i] / 3;
    const c2y = ys[i + 1] - (t[i + 1] * dx[i]) / 3;
    d += `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
  }
  return { d, xs, ys };
}

function GoldLineChart({ data }: { data: MonthDatum[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const update = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const income = data.map((d) => d.הכנסות);
  const expenses = data.map((d) => d.הוצאות);
  const months = data.map((d) => d.month);

  const { w, h } = size;
  const padT = 42;
  const padB = 36;
  const padL = 20;
  const padR = 64; // room for right-side ₪ tick labels + hero point
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const maxVal = Math.max(0, ...income, ...expenses);
  const { yMax, ticks } = niceScale(maxVal);

  const n = months.length;
  const xAt = (i: number) => padL + (n > 1 ? (innerW * i) / (n - 1) : innerW / 2);
  const yAt = (v: number) => padT + innerH * (1 - v / yMax);
  const baseY = yAt(0);

  const inc = monotonePath(income, xAt, yAt);
  const exp = monotonePath(expenses, xAt, yAt);

  const areaFrom = (p: { d: string; xs: number[] }) =>
    `${p.d} L${p.xs[p.xs.length - 1].toFixed(2)},${baseY.toFixed(2)} L${p.xs[0].toFixed(2)},${baseY.toFixed(2)} Z`;

  const ready = w > 0 && h > 0 && innerW > 0 && innerH > 0;

  return (
    <div style={{ width: "100%", height: 360 }} className="flex flex-col gk-line-chart">
      {/* legend pills (RTL start = right) */}
      <div className="flex gap-2.5 justify-start mb-1" dir="rtl">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium"
          style={{
            background: "rgba(190,158,78,.09)",
            border: "1px solid rgba(190,158,78,.14)",
            color: "#d6d0c2",
          }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: "#cdb477", boxShadow: "0 0 0 2px rgba(190,158,78,.18)" }}
          />
          הכנסות
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium"
          style={{
            background: "rgba(190,158,78,.09)",
            border: "1px solid rgba(190,158,78,.14)",
            color: "#d6d0c2",
          }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: "#e39b7e", boxShadow: "0 0 0 2px rgba(215,140,105,.18)" }}
          />
          הוצאות
        </span>
      </div>

      <div ref={wrapRef} className="relative flex-1">
        {ready && (
          <svg
            width={w}
            height={h}
            style={{ display: "block", overflow: "visible" }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              let best = 0;
              let bestD = Infinity;
              for (let i = 0; i < n; i++) {
                const dd = Math.abs(xAt(i) - x);
                if (dd < bestD) {
                  bestD = dd;
                  best = i;
                }
              }
              setHover(best);
            }}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="gcIncLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#D8BE77" />
                <stop offset="1" stopColor="#BE9E4E" />
              </linearGradient>
              <linearGradient id="gcIncFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="rgba(190,158,78,.22)" />
                <stop offset="1" stopColor="rgba(190,158,78,0)" />
              </linearGradient>
              <linearGradient id="gcExpFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="rgba(215,140,105,.16)" />
                <stop offset="1" stopColor="rgba(215,140,105,0)" />
              </linearGradient>
              {/* fade the right edge so the closed-area drop has no hard vertical seam */}
              <linearGradient id="gcFadeRight" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#fff" />
                <stop offset="0.9" stopColor="#fff" />
                <stop offset="1" stopColor="#000" />
              </linearGradient>
              <mask id="gcAreaMask">
                <rect x="0" y="0" width={w} height={h} fill="url(#gcFadeRight)" />
              </mask>
              <filter id="gcHalo" x="-120%" y="-120%" width="340%" height="340%">
                <feGaussianBlur stdDeviation="4.2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* y hairlines + ₪ tick labels (right side, RTL) */}
            {ticks.map((v) => {
              const y = yAt(v);
              return (
                <g key={v}>
                  <line
                    x1={padL}
                    y1={y}
                    x2={w - padR}
                    y2={y}
                    stroke="rgba(190,158,78,.08)"
                    strokeWidth={1}
                  />
                  {v !== yMax && (
                    <text
                      x={w - padR + 12}
                      y={y + 4}
                      fill="#A79F90"
                      fontSize={12}
                      textAnchor="start"
                    >
                      {tickLabel(v)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* monthly profit-gap connectors — barely-there dashed gold,
                drawn BEHIND areas/lines. Skip when the two points nearly touch. */}
            {months.map((_, i) => {
              const incY = inc.ys[i];
              const expY = exp.ys[i];
              const yHi = Math.min(incY, expY);
              const yLo = Math.max(incY, expY);
              if (yLo - yHi < 14) return null;
              const gap = 6;
              const hot = hover === i;
              return (
                <line
                  key={`gap${i}`}
                  x1={xAt(i)}
                  y1={yHi + gap}
                  x2={xAt(i)}
                  y2={yLo - gap}
                  stroke={hot ? "rgba(190,158,78,.32)" : "rgba(190,158,78,.18)"}
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
              );
            })}

            {/* area fills (expense under income); right edge faded via mask */}
            <path d={areaFrom(exp)} fill="url(#gcExpFill)" mask="url(#gcAreaMask)" />
            <path d={areaFrom(inc)} fill="url(#gcIncFill)" mask="url(#gcAreaMask)" />

            {/* hover guide */}
            {hover !== null && (
              <line
                x1={xAt(hover)}
                y1={padT - 8}
                x2={xAt(hover)}
                y2={baseY}
                stroke="rgba(190,158,78,.22)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {/* lines */}
            <path
              d={exp.d}
              fill="none"
              stroke="#E39B7E"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={inc.d}
              fill="none"
              stroke="url(#gcIncLine)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* month labels */}
            {months.map((mm, i) => (
              <text
                key={`m${i}`}
                x={xAt(i)}
                y={h - 8}
                fill="#A79F90"
                fontSize={13}
                textAnchor="middle"
              >
                {mm}
              </text>
            ))}

            {/* expense dots + labels BELOW (copper) */}
            {exp.xs.map((x, i) => {
              const y = exp.ys[i];
              // Always below the expense point. Clamp above the month-axis band,
              // and if this is a loss month (income point sits lower than the
              // expense point) push the label down toward the axis to stay off
              // the income area — never above the expense point.
              const axisBand = h - padB + 6;
              let ly = y + 16;
              if (inc.ys[i] > y) ly = Math.max(ly, y + 16);
              ly = Math.min(ly, axisBand);
              const label = kLabel(expenses[i]);
              const hot = hover === i;
              return (
                <g key={`e${i}`}>
                  <circle cx={x} cy={y} r={hot ? 4.4 : 3.6} fill="#E39B7E" />
                  <circle cx={x} cy={y} r={1.5} fill="#171106" />
                  {label && (
                    <text
                      x={x}
                      y={ly}
                      fill="#E8B29B"
                      fontSize={13}
                      fontWeight={600}
                      textAnchor="middle"
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* income dots + labels ABOVE (off-white); hero on the last point */}
            {inc.xs.map((x, i) => {
              const y = inc.ys[i];
              const last = i === inc.xs.length - 1;
              const label = kLabel(income[i]);
              const hot = hover === i;
              return (
                <g key={`i${i}`}>
                  {last ? (
                    <>
                      <circle cx={x} cy={y} r={8} fill="rgba(190,158,78,.18)" filter="url(#gcHalo)" />
                      <circle cx={x} cy={y} r={hot ? 6 : 5.2} fill="#D8BE77" />
                      <circle cx={x} cy={y} r={2.2} fill="#171106" />
                    </>
                  ) : (
                    <>
                      <circle cx={x} cy={y} r={hot ? 4.4 : 3.6} fill="#D8BE77" />
                      <circle cx={x} cy={y} r={1.5} fill="#171106" />
                    </>
                  )}
                  {label && (
                    <text
                      x={x}
                      y={y - 13}
                      fill="#D6D0C2"
                      fontSize={13.5}
                      fontWeight={700}
                      textAnchor="middle"
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* hover tooltip — exact ILS values */}
        {ready && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 rounded-xl px-3 py-2 text-xs"
            style={{
              left: Math.min(Math.max(xAt(hover), 70), w - 70),
              top: 0,
              transform: "translateX(-50%)",
              background: "#171106",
              border: "1px solid rgba(214,178,108,0.32)",
              color: "#e2dccd",
              direction: "rtl",
              whiteSpace: "nowrap",
              boxShadow: "0 10px 30px -12px rgba(0,0,0,.8)",
            }}
          >
            <div className="font-semibold mb-1" style={{ color: "#e7d9ab" }}>
              {months[hover]}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#cdb477" }} />
              הכנסות: {ils.format(income[hover] || 0)}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#e39b7e" }} />
              הוצאות: {ils.format(expenses[hover] || 0)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

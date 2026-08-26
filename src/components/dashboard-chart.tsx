"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isCountableRevenue, type InvoiceDocument, type Expense } from "@/lib/types";

interface Props {
  documents: InvoiceDocument[];
  expenses: Expense[];
}

type MonthDatum = { month: string; הכנסות: number; הוצאות: number };

/* ------------------------------------------------------------------ */
/* Time-range selection                                                */
/* ------------------------------------------------------------------ */

type RangeKey = "day" | "week" | "month" | "6m" | "year" | "2y" | "5y";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "day", label: "יום" },
  { key: "week", label: "שבוע" },
  { key: "month", label: "חודש" },
  { key: "6m", label: "6 חודשים" },
  { key: "year", label: "שנה" },
  { key: "2y", label: "שנתיים" },
  { key: "5y", label: "5 שנים" },
];

const RANGE_STORAGE_KEY = "dashboard-chart-range";
const SERIES_STORAGE_KEY = "dashboard-chart-series";

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

/** Short month names for the dense (12/24-point) views. */
const HEBREW_MONTHS_SHORT = [
  "ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יונ׳",
  "יול׳", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳",
];

/**
 * A bucket is matched by ISO-date string prefix: "2026-08-09" (a day),
 * "2026-08" (a month), or "2026" (a year). Document/expense dates are
 * ISO strings, so prefix matching buckets all three granularities.
 */
type Bucket = { prefix: string; label: string };

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildBuckets(range: RangeKey): Bucket[] {
  const now = new Date();
  const buckets: Bucket[] = [];
  const dayBuckets = (count: number) => {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      buckets.push({ prefix: isoDay(d), label: `${d.getDate()}.${d.getMonth() + 1}` });
    }
  };
  const monthBuckets = (count: number, short: boolean, withYear: boolean) => {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const name = short ? HEBREW_MONTHS_SHORT[d.getMonth()] : HEBREW_MONTHS[d.getMonth()];
      buckets.push({
        prefix: isoMonth(d),
        label: withYear ? `${name} ${String(d.getFullYear()).slice(2)}` : name,
      });
    }
  };
  switch (range) {
    case "day":
      // Document dates carry day granularity, so "today" is a single point.
      buckets.push({ prefix: isoDay(now), label: "היום" });
      break;
    case "week":
      dayBuckets(7);
      break;
    case "month":
      dayBuckets(30);
      break;
    case "6m":
      monthBuckets(6, false, false);
      break;
    case "year":
      monthBuckets(12, true, false);
      break;
    case "2y":
      monthBuckets(24, true, true);
      break;
    case "5y":
      for (let i = 4; i >= 0; i--) {
        const y = now.getFullYear() - i;
        buckets.push({ prefix: String(y), label: String(y) });
      }
      break;
  }
  return buckets;
}

/**
 * The chart palette, single-sourced. Every place a series is painted
 * (legend pill, area fill, stroke, point, value label, hover tooltip key)
 * reads from here. (Before this existed the tooltip's colour dots still carried
 * the pre-redesign obsidian values, so the same series was drawn in three
 * different colours depending on where you looked.)
 */
const SERIES = {
  income: {
    label: "הכנסות",
    /** points, legend line; the ink line has no gradient family any more,
     * except the hero (most recent) point, which is the one touch of
     * brand orange on the whole chart. */
    dot: "#1c1917",
    heroDot: "#f97316",
    heroText: "#c2410c",
    strokeFrom: "#1c1917",
    strokeTo: "#1c1917",
    areaTop: "rgba(249,115,22,.10)",
    areaBottom: "rgba(249,115,22,0)",
    valueText: "#1c1917",
  },
  expense: {
    label: "הוצאות",
    dot: "#a8a29e",
    valueText: "#57534e",
  },
} as const;

/** Compact ₪k label for the value-labels above the income points.
 * Typed loosely to match recharts' LabelFormatter (string | number | undefined). */
function kLabel(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!n || Number.isNaN(n)) return "";
  // Daily buckets are often under ₪1000 - "₪0k" would be nonsense there.
  if (n < 1000) return `₪${Math.round(n)}`;
  return `₪${Math.round(n / 1000)}k`;
}

/** Full ILS currency (used in the hover tooltip, exact, not rounded to k). */
const ils = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

export function DashboardChart({ documents, expenses }: Props) {
  const [range, setRange] = useState<RangeKey>("6m");

  // Restore the saved range after mount (not in the initializer - the page is
  // server-rendered first, and localStorage there would cause a hydration mismatch).
  useEffect(() => {
    const saved = localStorage.getItem(RANGE_STORAGE_KEY);
    if (saved && RANGES.some((r) => r.key === saved)) setRange(saved as RangeKey);
  }, []);

  const pickRange = (key: RangeKey) => {
    setRange(key);
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, key);
    } catch {
      /* private mode - selection just won't persist */
    }
  };

  const data = useMemo<MonthDatum[]>(() => {
    return buildBuckets(range).map((b) => {
      const income = documents
        .filter((doc) => doc.status === "paid" && isCountableRevenue(doc) && doc.date.startsWith(b.prefix))
        .reduce((sum, doc) => sum + (doc.totalIls ?? doc.total), 0);

      const bucketExpenses = expenses
        .filter((e) => e.date.startsWith(b.prefix))
        .reduce((sum, e) => sum + e.amount, 0);

      return {
        month: b.label,
        הכנסות: income,
        הוצאות: bucketExpenses,
      };
    });
  }, [documents, expenses, range]);

  // Empty state only when the account has no data at all - a quiet week
  // should still render (flat at ₪0), not hide the chart.
  const hasAnyData =
    expenses.length > 0 ||
    documents.some((doc) => doc.status === "paid" && isCountableRevenue(doc));

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

  // Robinhood-style dual monotone-cubic line chart (custom SVG).
  return <MonthlyLineChart data={data} range={range} onRangeChange={pickRange} />;
}

/* ------------------------------------------------------------------ */
/* Custom SVG line chart                                               */
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
 * Fritsch-Carlson monotone cubic interpolation → smooth cubic-bezier path.
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

function MonthlyLineChart({
  data,
  range,
  onRangeChange,
}: {
  data: MonthDatum[];
  range: RangeKey;
  onRangeChange: (key: RangeKey) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);

  // Solo mode: click a legend pill to isolate that series (and rescale the
  // y-axis to it - otherwise expenses are squashed flat under a taller income
  // line). Click the same pill again to bring both series back.
  const [solo, setSolo] = useState<"income" | "expense" | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem(SERIES_STORAGE_KEY);
    if (saved === "income" || saved === "expense") setSolo(saved);
  }, []);
  const toggleSolo = (key: "income" | "expense") => {
    setSolo((prev) => {
      const next = prev === key ? null : key;
      try {
        if (next) localStorage.setItem(SERIES_STORAGE_KEY, next);
        else localStorage.removeItem(SERIES_STORAGE_KEY);
      } catch {
        /* private mode */
      }
      return next;
    });
  };
  const showIncome = solo !== "expense";
  const showExpense = solo !== "income";

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

  const maxVal = Math.max(
    0,
    ...(showIncome ? income : []),
    ...(showExpense ? expenses : []),
  );
  const { yMax, ticks } = niceScale(maxVal);

  const n = months.length;
  const xAt = (i: number) => padL + (n > 1 ? (innerW * i) / (n - 1) : innerW / 2);
  const yAt = (v: number) => padT + innerH * (1 - v / yMax);
  const baseY = yAt(0);

  const inc = monotonePath(income, xAt, yAt);
  const exp = monotonePath(expenses, xAt, yAt);

  // Dense views (30 daily points, 24 months) can't label every point.
  // Anchor the visible x-labels to the LAST point so "now" is always labeled.
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const showXLabel = (i: number) => (n - 1 - i) % labelEvery === 0;
  // Per-point ₪ value labels only when they won't collide with each other.
  const showValueLabels = n <= 12;

  const areaFrom = (p: { d: string; xs: number[] }) =>
    `${p.d} L${p.xs[p.xs.length - 1].toFixed(2)},${baseY.toFixed(2)} L${p.xs[0].toFixed(2)},${baseY.toFixed(2)} Z`;

  const ready = w > 0 && h > 0 && innerW > 0 && innerH > 0;

  return (
    <div style={{ width: "100%", height: 360 }} className="flex flex-col gk-line-chart">
      {/* header row: legend pills (RTL start = right) + time-range selector (left) */}
      <div className="flex flex-wrap items-center gap-2.5 mb-1" dir="rtl">
        {(Object.entries(SERIES) as ["income" | "expense", (typeof SERIES)[keyof typeof SERIES]][]).map(
          ([key, s]) => {
            const on = key === "income" ? showIncome : showExpense;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={solo === key}
                title={solo === key ? "הצג את שתי הסדרות" : `הצג רק ${s.label}`}
                onClick={() => toggleSolo(key)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium transition-opacity cursor-pointer"
                style={{
                  background: "rgba(249,115,22,.08)",
                  border: "1px solid rgba(249,115,22,.30)",
                  color: "#5a5245",
                  opacity: on ? 1 : 0.4,
                }}
              >
                {key === "income" ? (
                  <span
                    className="inline-block"
                    style={{ width: 14, height: 2, background: "#1c1917" }}
                  />
                ) : (
                  <span
                    className="inline-block"
                    style={{ width: 14, height: 0, borderTop: "1.5px dashed #a8a29e" }}
                  />
                )}
                {s.label}
              </button>
            );
          },
        )}
        <div
          className="mr-auto flex flex-wrap justify-center rounded-lg p-0.5"
          role="tablist"
          aria-label="טווח זמן"
          style={{
            background: "rgba(249,115,22,.08)",
            border: "1px solid rgba(249,115,22,.30)",
          }}
        >
          {RANGES.map((r) => {
            const active = r.key === range;
            return (
              <button
                key={r.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onRangeChange(r.key)}
                className="rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors"
                style={
                  active
                    ? {
                        background: "linear-gradient(135deg, #f97316, #e11d48)",
                        color: "#ffffff",
                        boxShadow: "0 1px 4px rgba(225,29,72,.35)",
                      }
                    : { color: "#5a5245" }
                }
              >
                {r.label}
              </button>
            );
          })}
        </div>
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
                <stop offset="0" stopColor={SERIES.income.strokeFrom} />
                <stop offset="1" stopColor={SERIES.income.strokeTo} />
              </linearGradient>
              <linearGradient id="gcIncFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={SERIES.income.areaTop} />
                <stop offset="1" stopColor={SERIES.income.areaBottom} />
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
                    stroke="#ece8df"
                    strokeWidth={1}
                  />
                  {v !== yMax && (
                    <text
                      x={w - padR + 12}
                      y={y + 4}
                      fill="#57534e"
                      fontSize={12}
                      textAnchor="start"
                    >
                      {tickLabel(v)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* monthly profit-gap connectors: barely-there neutral hairlines,
                drawn BEHIND areas/lines. Skip when the two points nearly touch. */}
            {showIncome && showExpense && months.map((_, i) => {
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
                  stroke={hot ? "#ece8df" : "rgba(0,0,0,0)"}
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
              );
            })}

            {/* area fill (income only, no touch of orange under the flat
                grey expense line); right edge faded via mask */}
            {showIncome && <path d={areaFrom(inc)} fill="url(#gcIncFill)" mask="url(#gcAreaMask)" />}

            {/* hover guide */}
            {hover !== null && (
              <line
                x1={xAt(hover)}
                y1={padT - 8}
                x2={xAt(hover)}
                y2={baseY}
                stroke="#d6d3d1"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {/* lines. Ink + one touch of brand orange (2026-08-26): flat
                strokes, no ribbon underside. Income is a solid ink line;
                expense is a dashed neutral line, so the two read apart by
                shape, not by a loud colour pairing. */}
            {showExpense && (
              <path
                d={exp.d}
                fill="none"
                stroke={SERIES.expense.dot}
                strokeWidth={1.5}
                strokeDasharray="3 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {showIncome && (
              <path
                d={inc.d}
                fill="none"
                stroke="url(#gcIncLine)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* x-axis labels (sparse in dense views) */}
            {months.map((mm, i) =>
              showXLabel(i) ? (
                <text
                  key={`m${i}`}
                  x={xAt(i)}
                  y={h - 8}
                  fill="#57534e"
                  fontSize={13}
                  textAnchor="middle"
                >
                  {mm}
                </text>
              ) : null,
            )}

            {/* expense dots + labels BELOW (neutral grey) */}
            {showExpense && exp.xs.map((x, i) => {
              const y = exp.ys[i];
              // Always below the expense point. Clamp above the month-axis band,
              // and if this is a loss month (income point sits lower than the
              // expense point) push the label down toward the axis to stay off
              // the income area, never above the expense point.
              const axisBand = h - padB + 6;
              let ly = y + 16;
              if (inc.ys[i] > y) ly = Math.max(ly, y + 16);
              ly = Math.min(ly, axisBand);
              const hot = hover === i;
              const label = showValueLabels || hot ? kLabel(expenses[i]) : "";
              return (
                <g key={`e${i}`}>
                  <circle cx={x} cy={y} r={hot ? 4.4 : n > 12 ? 2.6 : 3.6} fill={SERIES.expense.dot} />
                  <circle cx={x} cy={y} r={1.5} fill="#ffffff" />
                  {label && (
                    <text
                      x={x}
                      y={ly}
                      fill={SERIES.expense.valueText}
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

            {/* income dots + labels ABOVE; the one touch of brand orange
                on the whole chart lives on the hero (most recent) point. */}
            {showIncome && inc.xs.map((x, i) => {
              const y = inc.ys[i];
              const last = i === inc.xs.length - 1;
              const hot = hover === i;
              const label = showValueLabels || hot || last ? kLabel(income[i]) : "";
              return (
                <g key={`i${i}`}>
                  {last ? (
                    <circle
                      cx={x}
                      cy={y}
                      r={hot ? 5.5 : 4.5}
                      fill={SERIES.income.heroDot}
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  ) : (
                    <>
                      <circle cx={x} cy={y} r={hot ? 4.4 : n > 12 ? 2.6 : 3.6} fill={SERIES.income.dot} />
                      <circle cx={x} cy={y} r={1.5} fill="#ffffff" />
                    </>
                  )}
                  {label && (
                    <text
                      x={x}
                      y={y - 13}
                      fill={last ? SERIES.income.heroText : SERIES.income.valueText}
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

        {/* hover tooltip: exact ILS values */}
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
            {/* The panel stays dark on purpose (it floats over the plot); only
                the colour keys must match the lines they label. */}
            {showIncome && (
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: SERIES.income.dot }}
                />
                {SERIES.income.label}: {ils.format(income[hover] || 0)}
              </div>
            )}
            {showExpense && (
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: SERIES.expense.dot }}
                />
                {SERIES.expense.label}: {ils.format(expenses[hover] || 0)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

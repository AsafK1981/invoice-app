"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { formatCurrencyWhole, shekel } from "@/lib/format";
import { niceScale, tickLabel } from "@/components/dashboard-chart";

/**
 * Income against expenses as extruded ("3D") grouped bars, for /admin/budget.
 *
 * Asaf picked this over the dashboard's thin line chart on 2026-09-17
 * (option A of three mockups): warm green for money in, soft rose-red for
 * money out, each bar with a front, a side and a top face. It is deliberately
 * NOT the dashboard style, and deliberately lives only on the operator's own
 * page; the dashboard keeps its ink line.
 *
 * The depth is decoration only: every bar's FRONT face starts on the baseline
 * and ends at its value, so heights are read off the same single axis a flat
 * bar chart would use.
 */

export interface BudgetBarDatum {
  label: string;
  income: number;
  expense: number;
}

const PALETTE = {
  income: { label: "הכנסות", from: "#7DB45A", to: "#4F8334", side: "#3F6B29", top: "#A3D081" },
  expense: { label: "הוצאות", from: "#F08D93", to: "#D4515A", side: "#B5414A", top: "#F8B5B9" },
} as const;

type SeriesKey = keyof typeof PALETTE;

const HEIGHT = 340;

/**
 * The number printed above a bar. One decimal of a thousand, because at this
 * page's scale the dashboard's whole-k label printed 2,535 and 3,354 as the
 * same "3k" over two bars of visibly different height.
 */
function barLabel(value: number): string {
  if (value < 1000) return shekel(String(Math.round(value)));
  return shekel(`${Number((value / 1000).toFixed(1))}k`);
}

export function BudgetBarChart<K extends string>({
  data,
  range,
  ranges,
  onRangeChange,
}: {
  data: BudgetBarDatum[];
  range: K;
  ranges: { key: K; label: string }[];
  onRangeChange: (key: K) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const update = () => setW(node.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const n = data.length;
  const h = HEIGHT;
  const padT = 34;
  const padB = 40;
  const padL = 8;
  const padR = 56; // room for the shekel tick labels
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const ready = w > 0 && innerW > 0 && n > 0;

  const maxVal = Math.max(0, ...data.map((d) => Math.max(d.income, d.expense)));
  const { yMax, ticks } = niceScale(maxVal);
  const yAt = (v: number) => padT + innerH * (1 - v / yMax);
  const baseY = yAt(0);

  // One slot per bucket, a pair of bars centred in it. Everything scales down
  // together so thirty days still fit a phone: bar, gap and depth shrink, the
  // proportions of the 3D look stay.
  const slot = ready ? innerW / n : 0;
  const barW = Math.max(2.5, Math.min(34, slot * 0.34));
  const gap = Math.max(1, barW * 0.22);
  const depth = Math.max(1.5, Math.min(10, barW * 0.3));
  const slotX = (i: number) => padL + slot * i;

  // Value labels need ~84px a pair; below that they collide, and the hover
  // tooltip carries the numbers instead. The two labels of a pair grow AWAY
  // from each other (income ends at its bar's right edge, expense starts at its
  // bar's left edge), so a short bar's label is never printed across the side
  // face of the tall bar standing next to it.
  const showValueLabels = slot >= 84;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 44))));
  const showXLabel = (i: number) => (n - 1 - i) % labelEvery === 0;

  const bar = (key: SeriesKey, x: number, value: number) => {
    if (!(value > 0)) return null;
    const p = PALETTE[key];
    const y = yAt(value);
    const height = baseY - y;
    return (
      <g>
        <polygon
          points={`${x + barW},${y} ${x + barW + depth},${y - depth} ${x + barW + depth},${baseY - depth} ${x + barW},${baseY}`}
          fill={p.side}
        />
        <polygon
          points={`${x},${y} ${x + depth},${y - depth} ${x + barW + depth},${y - depth} ${x + barW},${y}`}
          fill={p.top}
        />
        <rect x={x} y={y} width={barW} height={height} fill={`url(#${uid}-${key})`} />
      </g>
    );
  };

  const hovered = hover !== null ? data[hover] : null;

  return (
    <div className="flex flex-col">
      {/* legend (RTL start = right) + granularity tabs (left) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2" dir="rtl">
        {(Object.keys(PALETTE) as SeriesKey[]).map((key) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-stone-700">
            <span
              className="inline-block w-3 h-3 rounded-[4px]"
              style={{ background: `linear-gradient(180deg, ${PALETTE[key].from}, ${PALETTE[key].to})` }}
            />
            {PALETTE[key].label}
          </span>
        ))}
        <div
          className="mr-auto flex flex-wrap justify-center rounded-lg p-0.5"
          role="tablist"
          aria-label="רמת פירוט"
          style={{
            background: "rgba(217, 106, 29, 0.132)",
            border: "1px solid rgba(217, 106, 29, 0.42)",
          }}
        >
          {ranges.map((r) => {
            const active = r.key === range;
            return (
              <button
                key={r.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onRangeChange(r.key)}
                className="rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                style={
                  active
                    ? {
                        background: "linear-gradient(135deg, #D96A1D, #A94E16)",
                        color: "#ffffff",
                        boxShadow: "0 1px 4px rgba(31, 35, 43, 0.3)",
                      }
                    : { color: "#6B6560" }
                }
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={wrapRef} className="relative" style={{ height: h }}>
        {ready && (
          <svg
            width={w}
            height={h}
            role="img"
            aria-label="גרף עמודות: הכנסות מול הוצאות לפי תקופה"
            // Plain LTR coordinates inside the RTL page: time runs left to
            // right like every other chart in the app, and text anchors mean
            // what they say.
            style={{ display: "block", direction: "ltr", touchAction: "pan-y" }}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const i = Math.floor((e.clientX - rect.left - padL) / slot);
              setHover(i >= 0 && i < n ? i : null);
            }}
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const i = Math.floor((e.clientX - rect.left - padL) / slot);
              setHover(i >= 0 && i < n ? i : null);
            }}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              {(Object.keys(PALETTE) as SeriesKey[]).map((key) => (
                <linearGradient key={key} id={`${uid}-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={PALETTE[key].from} />
                  <stop offset="1" stopColor={PALETTE[key].to} />
                </linearGradient>
              ))}
            </defs>

            {ticks.map((v) => (
              <g key={v}>
                <line x1={padL} y1={yAt(v)} x2={w - padR} y2={yAt(v)} stroke="#EFE7DC" strokeWidth={1} />
                <text x={w - padR + 10} y={yAt(v) + 4} fill="#9A9086" fontSize={12} textAnchor="start">
                  {tickLabel(v)}
                </text>
              </g>
            ))}

            {/* the floor the bars stand on */}
            <polygon
              points={`${padL},${baseY} ${padL + depth},${baseY - depth} ${w - padR},${baseY - depth} ${w - padR},${baseY}`}
              fill="#F3ECE2"
            />

            {/* hovered slot */}
            {hover !== null && (
              <rect
                x={slotX(hover)}
                y={padT - 10}
                width={slot}
                height={baseY - padT + 10}
                rx={8}
                fill="rgba(31, 35, 43, 0.045)"
              />
            )}

            {data.map((d, i) => {
              const cx = slotX(i) + slot / 2;
              const x1 = cx - barW - gap / 2 - depth / 2;
              const x2 = cx + gap / 2 - depth / 2;
              return (
                <g key={i}>
                  {bar("income", x1, d.income)}
                  {bar("expense", x2, d.expense)}
                  {showValueLabels && d.income > 0 && (
                    <text
                      x={x1 + barW + depth}
                      y={yAt(d.income) - depth - 7}
                      fill="#1F232B"
                      fontSize={13}
                      fontWeight={700}
                      textAnchor="end"
                    >
                      {barLabel(d.income)}
                    </text>
                  )}
                  {showValueLabels && d.expense > 0 && (
                    <text
                      x={x2 + depth + 2}
                      y={yAt(d.expense) - depth - 7}
                      fill="#6B6560"
                      fontSize={12}
                      fontWeight={500}
                      textAnchor="start"
                    >
                      {barLabel(d.expense)}
                    </text>
                  )}
                  {showXLabel(i) && (
                    <text x={cx} y={h - 12} fill="#6B6560" fontSize={13} textAnchor="middle">
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}

            <line x1={padL} y1={baseY} x2={w - padR} y2={baseY} stroke="#D9CDBD" strokeWidth={1.5} />
          </svg>
        )}

        {ready && hover !== null && hovered && (
          <div
            className="pointer-events-none absolute z-10 rounded-xl px-3 py-2 text-xs"
            style={{
              left: Math.min(Math.max(slotX(hover) + slot / 2, 80), w - 80),
              top: 0,
              transform: "translateX(-50%)",
              background: "#1F232B",
              color: "#F7F2EB",
              direction: "rtl",
              whiteSpace: "nowrap",
              boxShadow: "0 10px 30px -12px rgba(0,0,0,.8)",
            }}
          >
            <div className="font-semibold mb-1" style={{ color: "#F2A33C" }}>
              {hovered.label}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: PALETTE.income.from }} />
              {PALETTE.income.label}: {formatCurrencyWhole(Math.round(hovered.income))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: PALETTE.expense.from }} />
              {PALETTE.expense.label}: {formatCurrencyWhole(Math.round(hovered.expense))}
            </div>
            <div className="mt-1 pt-1 border-t border-white/15">
              מאזן: {formatCurrencyWhole(Math.round(hovered.income - hovered.expense))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

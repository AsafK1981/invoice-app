"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatCurrency } from "@/lib/format";

export interface BarDatum {
  key: string;
  /** Short axis label ("אוג׳") */
  label: string;
  /** Long label for the tooltip ("אוגוסט 2026") */
  title: string;
  income: number;
  expenses: number;
  /** Months outside the selected period paint faded, so the eye lands on the period. */
  active: boolean;
}

interface Props {
  data: BarDatum[];
}

const H = 236;
const PAD = { top: 12, right: 44, bottom: 30, left: 6 };

/** Axis step from a short list of "round" multiples so the ticks read as 0 / 1.5k / 3k / 4.5k, never 1.3k / 3.8k. */
function niceStep(rawMax: number, divisions = 4): number {
  if (rawMax <= 0) return 250;
  const raw = rawMax / divisions;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  const m = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((c) => c >= n) ?? 10;
  return m * p;
}

function tick(v: number): string {
  if (v === 0) return "0";
  if (v >= 1000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(v);
}

/**
 * Income vs expenses per month. Hand-drawn SVG (like the dashboard chart)
 * rather than recharts, so the reports page does not pull the 320KB chunk
 * for eight bars. RTL: the first month sits at the right edge, the axis
 * labels on the right where the reader starts.
 */
export function ReportsBarChart({ data }: Props) {
  const gradId = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  // Measure the container so text stays 11px and the chart stays 236px tall
  // at every width, instead of scaling the whole SVG like an image.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setW(Math.max(260, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rawMax = Math.max(0, ...data.map((d) => Math.max(d.income, d.expenses)));
  const step = niceStep(rawMax);
  const max = Math.max(step, Math.ceil(rawMax / step) * step);
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;
  const n = Math.max(1, data.length);
  const group = cw / n;
  const bw = Math.min(22, group * 0.28);
  const gap = Math.min(5, group * 0.06);
  // Below ~30px per month the 12 labels collide; show every other one.
  const labelEvery = group < 30 ? 2 : 1;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const yOf = (v: number) => PAD.top + ch - (ch * v) / max;

  const hovered = hover !== null ? data[hover] : null;
  const hoverX = hover !== null ? PAD.left + cw - (hover + 0.5) * group : 0;

  return (
    <div className="rpt-chart" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label="הכנסות מול הוצאות לפי חודש"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3E9A7B" />
            <stop offset="1" stopColor="#2A7A62" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yOf(v)}
              y2={yOf(v)}
              className="rpt-chart-grid"
            />
            <text x={W - PAD.right + 8} y={yOf(v) + 4} className="rpt-chart-tick">
              {tick(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          // RTL: index 0 at the right edge.
          const cx = PAD.left + cw - (i + 0.5) * group;
          const hi = (ch * d.income) / max;
          const he = Math.max((ch * d.expenses) / max, 2);
          const baseY = PAD.top + ch;
          // 3D extrusion depth (up-and-right). Light source top-left, so the
          // top face is lighter than the front and the right side is darker -
          // a consistent solid. Chosen by Asaf from the A/B/C mockup 2026-08-23.
          const D = Math.max(3, Math.min(6, bw * 0.4));
          const xInc = cx - bw - gap / 2;
          const yInc = baseY - hi;
          const xExp = cx + gap / 2;
          const yExp = baseY - he;
          // A single extruded bar = top face + right side face + front.
          const bar3d = (
            x: number,
            y: number,
            hgt: number,
            front: string,
            top: string,
            side: string,
            cls: string,
          ) => (
            <>
              <polygon
                points={`${x},${y} ${x + D},${y - D} ${x + bw + D},${y - D} ${x + bw},${y}`}
                fill={top}
                className={cls}
              />
              <polygon
                points={`${x + bw},${y} ${x + bw + D},${y - D} ${x + bw + D},${baseY - D} ${x + bw},${baseY}`}
                fill={side}
                className={cls}
              />
              <rect x={x} y={y} width={bw} height={hgt} fill={front} className={cls} />
            </>
          );
          return (
            <g
              key={d.key}
              className={`rpt-chart-group${d.active ? "" : " is-muted"}${hover === i ? " is-hover" : ""}`}
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(hover === i ? null : i)}
            >
              <rect
                x={cx - group / 2}
                y={PAD.top}
                width={group}
                height={ch}
                fill="transparent"
              />
              {bar3d(xInc, yInc, hi, `url(#${gradId})`, "#9ED8C3", "#236653", "rpt-chart-income")}
              {bar3d(xExp, yExp, he, "#F3CDB9", "#FDEEE6", "#E9997A", "rpt-chart-expense")}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 10} textAnchor="middle" className="rpt-chart-label">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="rpt-chart-tip"
          style={{ left: `${(hoverX / W) * 100}%` }}
          role="status"
        >
          <div className="rpt-chart-tip-title">{hovered.title}</div>
          <div className="rpt-chart-tip-row">
            <i className="rpt-chart-dot rpt-chart-dot-income" />
            <span>הכנסות</span>
            <b dir="ltr">{formatCurrency(hovered.income)}</b>
          </div>
          <div className="rpt-chart-tip-row">
            <i className="rpt-chart-dot rpt-chart-dot-expense" />
            <span>הוצאות</span>
            <b dir="ltr">{formatCurrency(hovered.expenses)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

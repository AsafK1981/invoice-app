"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Wide-table wrapper (2026-09-14). A plain `overflow-x-auto` technically
 * scrolls, but its scrollbar lives under the LAST row, a mouse wheel only
 * scrolls vertically, and in RTL the hidden part is the left edge - so with
 * large text a user saw half a table and no way to reach the rest. This adds,
 * only while the content is actually wider than the box: a bar with two arrow
 * buttons (sticky on desktop so it stays reachable in a long table) and a fade
 * on each edge that still has content behind it.
 */
export function HorizontalScroll({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1) {
      setMore((m) => (m.left || m.right ? { left: false, right: false } : m));
      return;
    }
    // RTL scrollLeft runs 0 -> -max (start is the right edge); LTR runs 0 -> max.
    const rtl = getComputedStyle(el).direction === "rtl";
    const pos = Math.abs(el.scrollLeft);
    const left = rtl ? pos < max - 1 : pos > 1;
    const right = rtl ? pos > 1 : pos < max - 1;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure]);

  const scroll = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const overflowing = more.left || more.right;
  const btn =
    "inline-flex items-center justify-center w-10 h-10 lg:w-9 lg:h-9 rounded-lg border border-stone-200 bg-white text-stone-700 hover:border-orange-300 hover:text-orange-700 disabled:opacity-35 disabled:pointer-events-none transition-colors";

  return (
    <div>
      {overflowing && (
        <div className="no-print lg:sticky lg:top-0 z-10 bg-white flex items-center justify-between gap-3 pb-3">
          <span className="text-sm text-stone-600">
            <span className="lg:hidden">הטבלה רחבה מהמסך - החליקו הצידה או השתמשו בחצים</span>
            <span className="hidden lg:inline">הטבלה רחבה מהמסך - השתמשו בחצים כדי לראות את כל העמודות</span>
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={() => scroll(1)} disabled={!more.right} className={btn} aria-label="גלילה ימינה">
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => scroll(-1)} disabled={!more.left} className={btn} aria-label="גלילה שמאלה">
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
      <div className="relative">
        <div
          ref={ref}
          role="region"
          aria-label={label}
          tabIndex={overflowing ? 0 : undefined}
          className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-orange-400 rounded-xl"
        >
          {children}
        </div>
        {more.right && (
          <div aria-hidden="true" className="no-print pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent" />
        )}
        {more.left && (
          <div aria-hidden="true" className="no-print pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-white to-transparent" />
        )}
      </div>
    </div>
  );
}

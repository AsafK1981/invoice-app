"use client";

import type { ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
  /** Where the tooltip floats relative to its trigger. Default: bottom. */
  side?: "top" | "bottom" | "left" | "right";
  /**
   * For top/bottom sides: how the tooltip aligns horizontally with the
   * trigger. "center" (default) — centered on trigger (can extend in both
   * directions). "start" — left-aligned in LTR, right-aligned in RTL.
   * "end" — opposite. Pick "start" when the trigger sits near the edge
   * of its container, otherwise the centered tooltip will clip.
   */
  align?: "start" | "center" | "end";
  /** Optional extra classes on the outer wrapper */
  className?: string;
}

export function Tooltip({ label, children, side = "bottom", align = "center", className = "" }: Props) {
  // Compute the position class for the floating label.
  let positionClass = "";
  if (side === "top" || side === "bottom") {
    const vertical = side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5";
    // Horizontal alignment. Using physical left/right (not logical) because
    // the icon buttons we use this on are themselves positioned with absolute
    // `left-3` / `right-3` — keeping the math consistent.
    const horizontal =
      align === "start"
        ? "left-0"
        : align === "end"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
    positionClass = `${vertical} ${horizontal}`;
  } else {
    positionClass =
      side === "left"
        ? "right-full top-1/2 -translate-y-1/2 mr-1.5"
        : "left-full top-1/2 -translate-y-1/2 ml-1.5";
  }

  return (
    <span className={`group relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-stone-900 text-white text-xs font-medium px-2 py-1 opacity-0 scale-95 transition-all duration-150 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100 shadow-lg ${positionClass}`}
      >
        {label}
      </span>
    </span>
  );
}

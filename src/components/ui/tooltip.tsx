"use client";

import type { ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
  /** Where the tooltip floats relative to its trigger. Default: bottom. */
  side?: "top" | "bottom" | "left" | "right";
  /** Optional extra classes on the outer wrapper (useful for forcing inline vs block) */
  className?: string;
}

/**
 * Lightweight CSS-only tooltip. Appears instantly on hover (no setTimeout),
 * dark pill, white text, fade transition. No JS state — just Tailwind
 * `group-hover` so it works inside `<Link>` and `<button>` alike.
 *
 * Wrap any element with it:
 *   <Tooltip label="עריכה"><button>...</button></Tooltip>
 *
 * Pairs well with replacing the native `title` attribute on icon
 * buttons — that one is sluggish and varies wildly across browsers.
 */
export function Tooltip({ label, children, side = "bottom", className = "" }: Props) {
  // Position classes for the floating label
  const positionClass =
    side === "top"
      ? "bottom-full left-1/2 -translate-x-1/2 mb-1.5"
      : side === "left"
      ? "right-full top-1/2 -translate-y-1/2 mr-1.5"
      : side === "right"
      ? "left-full top-1/2 -translate-y-1/2 ml-1.5"
      : "top-full left-1/2 -translate-x-1/2 mt-1.5";

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

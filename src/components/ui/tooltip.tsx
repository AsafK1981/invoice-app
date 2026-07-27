"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Reserved for future use, kept for backwards compat with callers */
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * Portal-rendered tooltip. Computes the trigger's viewport rect on hover
 * and renders the tooltip text directly into <body> with `position:fixed`.
 * That bypasses every ancestor `overflow:hidden` / transform-induced
 * clipping issue; the tooltip can extend anywhere on screen.
 *
 * The earlier CSS-only `position:absolute` version got clipped when the
 * trigger sat near the edge of an `overflow:hidden` ancestor. The portal
 * approach removes that whole class of bug.
 */
export function Tooltip({ label, children, side = "bottom", className = "" }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const tooltipId = useId();

  useEffect(() => setMounted(true), []);

  function show() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // 8px gap between trigger and tooltip
    const gap = 8;
    let top = 0;
    let left = 0;
    if (side === "bottom") {
      top = rect.bottom + gap;
      left = rect.left + rect.width / 2;
    } else if (side === "top") {
      top = rect.top - gap;
      left = rect.left + rect.width / 2;
    } else if (side === "left") {
      top = rect.top + rect.height / 2;
      left = rect.left - gap;
    } else {
      // right
      top = rect.top + rect.height / 2;
      left = rect.right + gap;
    }
    setPos({ top, left });
    setVisible(true);
  }

  function hide() {
    setVisible(false);
  }

  // Translate origin based on side, so the tooltip "grows" from the
  // trigger rather than from its own center mass.
  const transformOrigin =
    side === "bottom"
      ? "translate(-50%, 0)"
      : side === "top"
      ? "translate(-50%, -100%)"
      : side === "left"
      ? "translate(-100%, -50%)"
      : "translate(0, -50%)";

  return (
    <span
      ref={triggerRef}
      className={`inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={visible ? tooltipId : undefined}
    >
      {children}
      {mounted && visible && pos
        ? createPortal(
            <span
              id={tooltipId}
              role="tooltip"
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                transform: transformOrigin,
                zIndex: 9999,
                pointerEvents: "none",
                // Generous max-width so long labels still wrap nicely if a
                // truly long one is passed in.
                maxWidth: "min(280px, calc(100vw - 16px))",
              }}
              className="whitespace-nowrap rounded-md bg-stone-900 text-white text-xs font-medium px-2 py-1 shadow-lg"
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

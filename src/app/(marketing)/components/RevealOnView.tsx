"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Small client island that plays a one-shot "cascade in" reveal on the
 * wrapped element the first time it scrolls into view (IntersectionObserver
 * at ~15% visible), then disconnects - it never re-triggers on scroll back
 * up/down. The actual animation (opacity/transform/stagger/easing) lives in
 * CSS (see `.ml-adv-grid.js-reveal` in marketing-light.css); this component
 * only toggles two classes:
 *   - `js-reveal`  added on mount - "JS is here, CSS may hide-then-reveal".
 *     Server-rendered / no-JS markup never gets this class, so without JS
 *     the wrapped content is just the plain, fully-visible base styles.
 *   - `is-in`      added once the element intersects - CSS transitions the
 *     children to their visible end state.
 * `js-reveal` is removed again a little after the (longest, staggered)
 * transition should have finished, so hover/other interaction transitions
 * on the children fall back to their normal (non-reveal) timing instead of
 * being stuck on the slower entrance easing forever.
 *
 * page.tsx stays a server component (it exports `metadata`); this is the
 * one small piece that needs the browser APIs.
 */
type RevealOnViewProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Fraction of the element that must be visible to trigger. */
  threshold?: number;
  /** How long to keep the entrance-transition CSS active after triggering,
   *  generous enough to cover the slowest staggered child. */
  settleMs?: number;
};

export default function RevealOnView({
  children,
  className,
  style,
  threshold = 0.15,
  settleMs = 1800,
}: RevealOnViewProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.classList.add("js-reveal");

    if (typeof IntersectionObserver === "undefined") {
      // No IntersectionObserver support: reveal immediately rather than
      // ever leaving the content hidden.
      el.classList.add("is-in");
      return;
    }

    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("is-in");
            observer.disconnect();
            settleTimer = setTimeout(() => {
              el.classList.remove("js-reveal");
            }, settleMs);
          }
        }
      },
      { threshold }
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [threshold, settleMs]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

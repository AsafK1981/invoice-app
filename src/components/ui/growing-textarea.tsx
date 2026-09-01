"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/**
 * A textarea that is always as tall as its text (never shorter than `rows`),
 * so a multi-line value is read in full while it is typed instead of scrolled
 * inside a fixed box. Enter inserts a line break, as in any textarea; there is
 * no submit-on-Enter to fight.
 *
 * Height is recomputed whenever `value` changes, which also covers a value
 * that arrives already multi-line (a restored draft, an accepted proposal).
 */
export function GrowingTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function fit() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight is content + padding; the border (box-sizing: border-box)
    // has to be added back or the last line hides behind a scrollbar.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }

  useLayoutEffect(fit, [props.value]);

  // The value is not the only thing that changes how tall the text is: on a
  // phone the box gets narrower after mount (mobile QA 2026-09-01 caught the
  // box keeping its wide-layout height and growing an inner scrollbar), and a
  // late web font re-wraps lines. Re-fit when the WIDTH changes - never on our
  // own height writes, or the observer would loop.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastWidth = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === lastWidth) return;
      lastWidth = el.offsetWidth;
      fit();
    });
    ro.observe(el);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, []);

  return <textarea ref={ref} {...props} />;
}

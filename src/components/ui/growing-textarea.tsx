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

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight is content + padding; the border (box-sizing: border-box)
    // has to be added back or the last line hides behind a scrollbar.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, [props.value]);

  return <textarea ref={ref} {...props} />;
}

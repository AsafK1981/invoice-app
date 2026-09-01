"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/format";

/**
 * Shared "print this list" plumbing for the list pages (documents, clients,
 * products, expenses).
 *
 * The problem it solves: every list page paginates at 50 rows, so a plain
 * window.print() would print page 1 of 12 and nothing else, with the sidebar
 * and the filter bar glued on. The fix is a separate, print-only sheet that
 * renders EVERY filtered row.
 *
 * Why it is mounted only while printing (the `printing` state) rather than
 * living in the DOM permanently behind `hidden print:block`:
 *  - a hidden table of a few thousand rows is real DOM the browser lays out
 *    on every render of the page, for a feature used once a month;
 *  - keeping it unmounted means a plain Ctrl+P still prints the screen the
 *    way it always did. Only the explicit "הדפסה" button swaps in the sheet.
 */
export function usePrintSheet(): { printing: boolean; print: () => void } {
  const [printing, setPrinting] = useState(false);

  const print = useCallback(() => setPrinting(true), []);

  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    const done = () => {
      if (!cancelled) setPrinting(false);
    };
    window.addEventListener("afterprint", done);
    // Safety net: some browsers (older WebKit, a few mobile ones) never fire
    // afterprint. The window regaining focus after the print dialog closes is
    // the fallback signal that we are done.
    window.addEventListener("focus", done);

    // Two nested frames: the first is scheduled before React has committed +
    // painted the freshly mounted sheet, the second runs after it is on screen.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        window.print();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
      window.removeEventListener("afterprint", done);
      window.removeEventListener("focus", done);
    };
  }, [printing]);

  return { printing, print };
}

export type PrintColumn<T> = {
  key: string;
  header: string;
  /** "end" = numbers. In RTL that is the left edge of the sheet. */
  align?: "start" | "end";
  render: (row: T) => React.ReactNode;
  /** Cell for the totals row. The footer is rendered only if some column has one. */
  footer?: React.ReactNode;
};

/** Today as a local-time YYYY-MM-DD (never UTC: that shifts the date back an
 *  evening for users east of Greenwich, which is all of them). */
function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function PrintSheet<T>({
  title,
  subtitle,
  businessName,
  rows,
  rowKey,
  columns,
  countLabel,
}: {
  title: string;
  subtitle?: string;
  businessName?: string;
  rows: T[];
  rowKey: (row: T) => string;
  columns: PrintColumn<T>[];
  countLabel?: string;
}) {
  const hasFooter = columns.some((c) => c.footer !== undefined);

  return (
    <section className="print-sheet hidden print:block" dir="rtl" aria-hidden="true">
      <header className="mb-4">
        {businessName && (
          <div className="text-base font-bold text-stone-900">{businessName}</div>
        )}
        <h1 className="text-xl font-bold text-stone-900">{title}</h1>
        {subtitle && <div className="text-[11px] text-stone-700 mt-1">{subtitle}</div>}
        <div className="text-[11px] text-stone-700 mt-1">
          {countLabel ? `${countLabel} · ` : ""}
          {`הודפס ${formatDate(todayIso())}`}
        </div>
      </header>

      <table className="w-full text-[11px] leading-snug border-collapse">
        <thead>
          <tr className="border-b border-stone-300">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`py-1.5 px-2 font-bold ${c.align === "end" ? "text-left" : "text-right"}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-b border-stone-300">
              <td className="py-2 px-2 text-right" colSpan={columns.length}>
                אין שורות להדפסה
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-stone-300">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`py-1.5 px-2 ${
                      c.align === "end" ? "text-left tabular-nums" : "text-right"
                    }`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {hasFooter && (
          <tfoot>
            <tr className="border-b border-stone-300 font-bold">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`py-1.5 px-2 ${
                    c.align === "end" ? "text-left tabular-nums" : "text-right"
                  }`}
                >
                  {c.footer ?? ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { capturePageHtml, submitPageHtmlAsPdf } from "@/lib/report-pdf";

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
 *
 * `downloadPdf` reuses the same sheet for a real .pdf file: mount it, snapshot
 * the page (src/lib/report-pdf.ts), unmount, and send the snapshot to
 * /api/reports/pdf. `pdfBusy` stays true until the file has been handed to
 * the browser, so the button can show progress.
 */
export function usePrintSheet(): {
  printing: boolean;
  print: () => void;
  downloadPdf: (filename: string) => void;
  pdfBusy: boolean;
} {
  const [mode, setMode] = useState<"idle" | "print" | "pdf">("idle");
  const [pdfFilename, setPdfFilename] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const showToast = useToast();
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const printing = mode !== "idle";

  const print = useCallback(() => setMode("print"), []);
  const downloadPdf = useCallback((filename: string) => {
    setPdfFilename(filename);
    setPdfBusy(true);
    setMode("pdf");
  }, []);

  useEffect(() => {
    if (mode !== "pdf") return;
    let cancelled = false;
    let inner = 0;
    // Same two-frame wait as the print path: the sheet has to be painted
    // before the snapshot is taken.
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (cancelled) return;
        let html: string | null = null;
        try {
          html = capturePageHtml(pdfFilename);
        } catch {
          html = null;
        }
        setMode("idle");
        if (!html) {
          setPdfBusy(false);
          toastRef.current("יצירת ה-PDF נכשלה. נסה שוב.");
          return;
        }
        submitPageHtmlAsPdf(html, { filename: pdfFilename })
          .catch((err) => {
            toastRef.current(err instanceof Error ? err.message : "יצירת ה-PDF נכשלה. נסה שוב.");
          })
          .finally(() => setPdfBusy(false));
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [mode, pdfFilename]);

  useEffect(() => {
    if (mode !== "print") return;
    let cancelled = false;
    const done = () => {
      if (!cancelled) setMode("idle");
    };
    window.addEventListener("afterprint", done);
    // Safety net: some browsers (older WebKit, a few mobile ones) never fire
    // afterprint. The window regaining focus after the print dialog closes is
    // the fallback signal that we are done. Armed only once window.print()
    // has actually run: before that, a stray focus event (the user tabbing
    // away right after clicking הדפסה and coming back) would tear the sheet
    // down and silently cancel the print.
    let dialogOpened = false;
    const onFocus = () => {
      if (dialogOpened) done();
    };
    window.addEventListener("focus", onFocus);

    // Two nested frames: the first is scheduled before React has committed +
    // painted the freshly mounted sheet, the second runs after it is on screen.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        dialogOpened = true;
        window.print();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
      window.removeEventListener("afterprint", done);
      window.removeEventListener("focus", onFocus);
    };
  }, [mode]);

  return { printing, print, downloadPdf, pdfBusy };
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

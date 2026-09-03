"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { downloadCurrentPageAsPdf } from "@/lib/report-pdf";

/**
 * "הורדת PDF" for any page that already prints well.
 *
 * Sits next to the הדפסה button on every report / list page. Snapshots the
 * page and downloads it as a real .pdf file (see src/lib/report-pdf.ts);
 * the print dialog is no longer the only way to get a file.
 *
 * Two ways to drive it:
 *  - default: pass `filename`; the button captures the page itself.
 *  - list pages with a print-only sheet pass `onDownload` + `busy` from
 *    usePrintSheet, which mounts the sheet before capturing.
 *
 * Styling is the caller's: the default matches the quiet page buttons, and
 * pages with their own button skin pass `className` + `iconClassName`.
 */
export function DownloadPdfButton({
  filename,
  landscape,
  onDownload,
  busy: externalBusy,
  disabled,
  className = "pgbtn pgbtn-quiet no-print",
  iconClassName,
  title = "הורדת הדוח כקובץ PDF למחשב",
  label = "הורדת PDF",
}: {
  filename: string;
  landscape?: boolean;
  onDownload?: () => void;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
  iconClassName?: string;
  title?: string;
  label?: string;
}) {
  const [ownBusy, setOwnBusy] = useState(false);
  const showToast = useToast();
  const busy = externalBusy ?? ownBusy;

  async function handleClick() {
    if (busy) return;
    if (onDownload) {
      onDownload();
      return;
    }
    setOwnBusy(true);
    try {
      await downloadCurrentPageAsPdf({ filename, landscape });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "יצירת ה-PDF נכשלה. נסה שוב.");
    } finally {
      setOwnBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || busy}
      className={className}
      title={title}
      aria-busy={busy}
    >
      {busy ? (
        <Loader2 aria-hidden="true" className={`animate-spin ${iconClassName ?? ""}`} />
      ) : (
        <FileDown aria-hidden="true" className={iconClassName} />
      )}
      {busy ? "מכין PDF..." : label}
    </button>
  );
}

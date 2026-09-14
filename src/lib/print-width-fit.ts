import { capturePageHtml } from "@/lib/report-pdf";
import {
  LANDSCAPE_WIDTH_PX,
  MIN_ZOOM,
  PORTRAIT_WIDTH_PX,
  measureWorstOverflowRatio,
} from "@/lib/report-pdf-fit";

/**
 * Shrink-to-fit WIDTH for the browser's own print (2026-09-14).
 *
 * The twin of src/lib/report-pdf-fit.ts, which does this for the "הורדת PDF"
 * files. Printing had the same bug: a wide report table sits in a horizontal
 * scroll box, and on paper that box is a hard clip, so the printout showed
 * only some of the columns. It is worse on paper than on screen, because the
 * signed-in desktop shell uses a 14.5-15.5px root font while print (page
 * width, no sidebar) falls back to 16.5px: a table that fits on the monitor
 * can still be cut on A4.
 *
 * The hard part is measuring the PRINT layout before printing: `beforeprint`
 * fires while the page is still in screen layout. So the page is snapshotted
 * (the same capture the PDF route uses: scripts and .no-print stripped, all
 * CSS inlined) into a hidden frame exactly one printable page wide, with the
 * stylesheet's media rules rewritten so print rules apply and screen-only
 * rules do not. That frame lays out the way the paper will. Measure, zoom,
 * measure again, and apply the final zoom to the real page for print only.
 *
 * When portrait would have to shrink the text a lot, landscape is tried too
 * and wins if it prints bigger.
 */

const STYLE_ID = "print-width-fit";
/** Portrait below this zoom is worth comparing against landscape. */
const TRY_LANDSCAPE_BELOW = 0.85;
const MAX_PASSES = 5;

type Fit = { zoom: number; landscape: boolean };

/** Make print-only rules apply and screen-only rules never apply, so a frame
 *  on screen lays out like the printed page. Media TYPES only; width queries
 *  are answered by the frame's own width, which is the page width. */
function asPrintMedia(html: string): string {
  return html.replace(/@media\s[^{]*\{/gi, (prelude) =>
    prelude.replace(/\bprint\b/gi, "all").replace(/\bscreen\b/gi, "speech"),
  );
}

function waitForLoad(frame: HTMLIFrameElement, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    frame.addEventListener("load", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function measureFit(html: string, widthPx: number): Promise<number> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // No allow-scripts: the snapshot is inert markup. allow-same-origin so we
  // can read its layout.
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText =
    `position:fixed;top:0;left:-20000px;width:${widthPx}px;height:1200px;` +
    "border:0;visibility:hidden;pointer-events:none;";
  const loaded = waitForLoad(frame, 5000);
  frame.srcdoc = html;
  document.body.append(frame);
  try {
    await loaded;
    const doc = frame.contentDocument;
    if (!doc?.body) return 1;
    await Promise.race([doc.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);

    const zoomStyle = doc.createElement("style");
    doc.head.append(zoomStyle);
    let zoom = 1;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const ratio = measureWorstOverflowRatio(doc);
      if (ratio <= 1.002 || zoom <= MIN_ZOOM) break;
      // Round down a hair so sub-pixel rounding never clips the last column.
      zoom = Math.max(MIN_ZOOM, Math.floor((zoom / ratio) * 100) / 100);
      zoomStyle.textContent = `html { zoom: ${zoom} !important; }`;
    }
    return zoom;
  } finally {
    frame.remove();
  }
}

async function computeFit(): Promise<Fit> {
  const html = asPrintMedia(capturePageHtml());
  const portrait = await measureFit(html, PORTRAIT_WIDTH_PX);
  if (portrait >= TRY_LANDSCAPE_BELOW) return { zoom: portrait, landscape: false };
  const landscape = await measureFit(html, LANDSCAPE_WIDTH_PX);
  return landscape > portrait ? { zoom: landscape, landscape: true } : { zoom: portrait, landscape: false };
}

function applyFit(fit: Fit): void {
  document.getElementById(STYLE_ID)?.remove();
  if (fit.zoom >= 1 && !fit.landscape) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Matches the page box the frame was measured against: globals.css A4
  // portrait 15mm, or the same landscape box report-pdf.ts uses.
  style.textContent =
    "@media print {" +
    (fit.zoom < 1 ? ` html { zoom: ${fit.zoom} !important; }` : "") +
    (fit.landscape ? " @page { size: A4 landscape; margin: 12mm; }" : "") +
    " }";
  document.head.append(style);
}

/**
 * Pages whose print output is a document sheet (.receipt-view) have their own
 * one-page fit (src/lib/print-fit.ts) and call window.print() synchronously on
 * purpose (18ב render-then-set). Leave those completely alone.
 */
function hasOwnPrintLayout(): boolean {
  return !!document.querySelector(".receipt-view");
}

/**
 * Makes every print in the app fit the paper width: wraps window.print (so
 * every "הדפסה" button is covered without touching it) and Ctrl/Cmd+P.
 * Returns the uninstall function, for a React effect.
 */
export function installPrintWidthFit(): () => void {
  const nativePrint = window.print.bind(window);
  let busy = false;
  let fittedAt = 0;

  const fitThenPrint = async () => {
    if (busy) return;
    busy = true;
    // Callers set document.title for the printout's name and restore it right
    // after print() returns. We print later, so carry that title over.
    const title = document.title;
    try {
      applyFit(await computeFit());
    } catch {
      // A failed measurement must never cost the user the printout.
      applyFit({ zoom: 1, landscape: false });
    }
    const current = document.title;
    document.title = title;
    fittedAt = Date.now();
    try {
      nativePrint();
    } finally {
      document.title = current;
      busy = false;
    }
  };

  const patchedPrint = () => {
    if (hasOwnPrintLayout()) {
      nativePrint();
      return;
    }
    void fitThenPrint();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.key.toLowerCase() !== "p" && e.code !== "KeyP") return;
    if (hasOwnPrintLayout()) return;
    e.preventDefault();
    void fitThenPrint();
  };

  // The fit is for the page it was measured on. A later print we did not
  // start (the browser's menu, after navigating elsewhere) must not inherit
  // it. Safari prints asynchronously, hence a grace window, not a flag.
  const onBeforePrint = () => {
    if (Date.now() - fittedAt > 10_000) document.getElementById(STYLE_ID)?.remove();
  };

  window.print = patchedPrint;
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("beforeprint", onBeforePrint);
  return () => {
    if (window.print === patchedPrint) window.print = nativePrint;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("beforeprint", onBeforePrint);
    document.getElementById(STYLE_ID)?.remove();
  };
}

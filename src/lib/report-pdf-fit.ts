import type { Page } from "puppeteer-core";

/**
 * Shrink-to-fit WIDTH for the report PDF route (2026-09-14).
 *
 * A report table is as wide as its no-wrap columns need, and at print width
 * the app's base font is 18px, so the ten-column custom report came out about
 * 1.5x wider than an A4 landscape page. On screen that table sits in an
 * overflow-x-auto box; in the PDF the same box simply cut it off, and the file
 * showed only the right-hand half of the columns. Every list and report page
 * has the same shape, so the fix lives here, once, for all of them.
 *
 * How: lay the snapshot out in print media at the printable width, measure how
 * far the widest scroll box (or the page itself) runs past its own width, and
 * zoom the document out by that ratio. Measure again (fluid columns and
 * wrapping shift as the zoom changes) until it fits. Pages that already fit
 * are left untouched and print exactly as before.
 *
 * CSS `zoom`, not page.pdf({ scale }): Chrome's print scale mis-anchors RTL
 * documents, so the content drifted off the left edge and still clipped.
 */

// The printable width of the page, in CSS px (96dpi). These mirror the @page
// rules the PDF actually uses: globals.css pins A4 portrait with 15mm margins,
// and report-pdf.ts injects A4 landscape with 12mm margins when asked.
const MM_TO_PX = 96 / 25.4;
export const PORTRAIT_WIDTH_PX = Math.floor((210 - 2 * 15) * MM_TO_PX);
export const LANDSCAPE_WIDTH_PX = Math.floor((297 - 2 * 12) * MM_TO_PX);

// Below this the text is too small to read on paper. Content still wider than
// that is rare (thousands of px of no-wrap columns); it prints at the floor.
export const MIN_ZOOM = 0.4;
const MAX_PASSES = 5;

const ZOOM_STYLE_ID = "report-pdf-fit";

/** Fits the snapshot's width to the page. Returns the zoom applied (1 = none). */
export async function fitPageWidthForPdf(page: Page, opts: { landscape: boolean }): Promise<number> {
  const original = page.viewport();
  let zoom = 1;
  try {
    await page.emulateMediaType("print");
    await page.setViewport({ width: opts.landscape ? LANDSCAPE_WIDTH_PX : PORTRAIT_WIDTH_PX, height: 1200 });
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const ratio = await page.evaluate(measureWorstOverflowRatio);
      if (ratio <= 1.002 || zoom <= MIN_ZOOM) break;
      // Round down a hair so sub-pixel rounding never clips the last column.
      zoom = Math.max(MIN_ZOOM, Math.floor((zoom / ratio) * 100) / 100);
      await page.evaluate(applyZoom, ZOOM_STYLE_ID, zoom);
    }
  } finally {
    // Leave the page as page.pdf() expects to find it: the route's own
    // viewport and media, with only the zoom style added.
    await page.emulateMediaType();
    if (original) await page.setViewport(original);
  }
  return zoom;
}

/** Runs inside the page (serialized by puppeteer; must be self-contained). */
function applyZoom(id: string, zoom: number): void {
  let style = document.getElementById(id);
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.append(style);
  }
  style.textContent = `@media print { html { zoom: ${zoom} !important; } }`;
}

/**
 * Runs inside the page. Returns scrollWidth / clientWidth of the worst
 * horizontally clipped box (1 = nothing clipped).
 *
 * Counted: the document itself, every overflow-x auto/scroll box (the table
 * wrappers), and hidden/clip boxes that hold a table (rounded cards). Not
 * counted: other hidden boxes, which are deliberate clips (truncated names,
 * sr-only text, icons) and would otherwise shrink every page for nothing.
 *
 * Also used in the browser by src/lib/print-width-fit.ts, on a hidden frame,
 * which is why it takes the document to measure (puppeteer passes none).
 */
export function measureWorstOverflowRatio(doc?: Document): number {
  const d = doc ?? document;
  const view = d.defaultView ?? window;
  const root = d.documentElement;
  let worst = root.clientWidth > 0 ? root.scrollWidth / root.clientWidth : 1;
  for (const el of Array.from(d.body.querySelectorAll<HTMLElement>("*"))) {
    // A long report is mostly cells; none of them is ever the clipping box.
    if (/^(TD|TH|TR|TBODY|THEAD|TFOOT)$/.test(el.tagName)) continue;
    const ox = view.getComputedStyle(el).overflowX;
    if (ox === "visible") continue;
    if ((ox === "hidden" || ox === "clip") && !el.querySelector("table")) continue;
    if (el.clientWidth < 40) continue;
    worst = Math.max(worst, el.scrollWidth / el.clientWidth);
  }
  return worst;
}

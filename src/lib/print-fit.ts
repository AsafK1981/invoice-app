/**
 * One document = one printed page.
 *
 * The sheet (.doc-paper) is laid out for A4 with the 15mm @page margins from
 * globals.css, and document-paper.css stretches it to the full 267mm content
 * box so it reads as paper. A document whose content runs a few lines past
 * that box used to spill just its footer (or the bottom of its frame) onto a
 * second page, which is the worst possible print: a full sheet plus a strip.
 *
 * fitSheetToOnePage() measures the sheet in its PRINT geometry and, when the
 * content is taller than one page, shrinks the whole sheet with CSS `zoom`
 * (Chrome, Safari and Firefox 126+ all reflow under it, unlike transform)
 * just enough to fit, down to MIN_ZOOM. Below that the document is genuinely
 * multi-page (a 40-line invoice) and pagination with the existing
 * break-inside rules is the right answer, so nothing is changed.
 *
 * Why the measurement forces the geometry inline: Chrome dispatches
 * `beforeprint` BEFORE it switches the document to print layout, so a plain
 * offsetHeight at that moment is the on-screen sheet (794px wide, 74/68/44px
 * padding). Setting the print width and padding inline for the duration of
 * the measurement gives the same line wraps the printer will see (print inner
 * width 180mm - 6mm = 657px vs the on-screen 794 - 136 = 658px). The
 * `is-fluid` narrow-screen rules are switched off meanwhile: print media
 * queries evaluate against the 794px page box, so they never apply on paper,
 * but on a phone screen they would apply during the measurement and inflate it.
 */

/** A4 297mm minus the 2 x 15mm @page margins in globals.css. */
const PAGE_CONTENT_MM = 267;
/** A4 210mm minus the same margins. */
const SHEET_WIDTH_MM = 180;
/** document-paper.css print padding for .doc-paper. */
const PRINT_PADDING = "5mm 3mm";
/** Below this the document is really multi-page; leave pagination alone. */
const MIN_ZOOM = 0.7;
/** Breathing room for the few px the print-only rules (banner/stage head
 *  margins) can add on top of the forced-geometry measurement. */
const SAFETY_PX = 6;

const MEASURE_PROPS = ["width", "max-width", "padding", "min-height"] as const;
const FIT_PROPS = ["zoom", "width", "max-width", "min-height"] as const;

export function resetSheetFit(paper: HTMLElement): void {
  for (const p of new Set<string>([...MEASURE_PROPS, ...FIT_PROPS])) {
    paper.style.removeProperty(p);
  }
  delete paper.dataset.printFit;
}

/** Measure the sheet as it will print and shrink it to one page if needed.
 *  Idempotent: every call starts from the unfitted sheet. Returns the zoom
 *  applied, or 1 when the document already fits (or is truly multi-page). */
export function fitSheetToOnePage(paper: HTMLElement): number {
  resetSheetFit(paper);

  const wasFluid = paper.classList.contains("is-fluid");
  if (wasFluid) paper.classList.remove("is-fluid");
  const s = paper.style;
  s.setProperty("width", `${SHEET_WIDTH_MM}mm`, "important");
  s.setProperty("max-width", "none", "important");
  s.setProperty("padding", PRINT_PADDING, "important");
  s.setProperty("min-height", "0", "important");

  // mm -> px through the engine itself rather than assuming 96dpi.
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;width:0;height:${PAGE_CONTENT_MM}mm`;
  paper.appendChild(probe);
  const pagePx = probe.getBoundingClientRect().height;
  probe.remove();
  const contentPx = paper.getBoundingClientRect().height;

  resetSheetFit(paper);
  if (wasFluid) paper.classList.add("is-fluid");

  const avail = pagePx - SAFETY_PX;
  if (!(pagePx > 0) || contentPx <= avail) return 1;
  const zoom = avail / contentPx;
  if (zoom < MIN_ZOOM) return 1;

  // `zoom` scales the element's own box too, so divide the print geometry by
  // it: the zoomed sheet still spans the 180mm x 267mm content box exactly.
  s.setProperty("zoom", String(zoom));
  s.setProperty("width", `calc(${SHEET_WIDTH_MM}mm / ${zoom})`, "important");
  s.setProperty("max-width", "none", "important");
  s.setProperty("min-height", `calc(${PAGE_CONTENT_MM}mm / ${zoom})`, "important");
  paper.dataset.printFit = zoom.toFixed(3);
  return zoom;
}

/** Wire a sheet to the print lifecycle: fit on beforeprint, restore on
 *  afterprint. Returns the unsubscribe function (for a React effect). */
export function attachPrintFit(paper: HTMLElement): () => void {
  const before = () => {
    fitSheetToOnePage(paper);
  };
  const after = () => resetSheetFit(paper);
  window.addEventListener("beforeprint", before);
  window.addEventListener("afterprint", after);
  return () => {
    window.removeEventListener("beforeprint", before);
    window.removeEventListener("afterprint", after);
    resetSheetFit(paper);
  };
}

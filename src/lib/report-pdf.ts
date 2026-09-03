import { supabase } from "@/lib/supabase";

/**
 * "Download PDF" for report and list pages.
 *
 * The browser can already print these pages (Ctrl+P → Save as PDF), and every
 * page carries the @media print CSS that makes that output look right. What
 * users asked for is the same result as a FILE, without the print dialog.
 *
 * So: snapshot the page exactly as it stands (the DOM plus every stylesheet,
 * inlined), post it to /api/reports/pdf, and headless Chrome there prints it
 * with the same print CSS. Everything the print rules hide on screen
 * (.no-print, the sidebar, the filter bars) is hidden in the file too.
 */

export type ReportPdfOptions = {
  /** Human filename, Hebrew welcome. ".pdf" is added if missing. */
  filename: string;
  landscape?: boolean;
};

const STRIP_SELECTOR = [
  "script",
  "noscript",
  "template",
  "iframe",
  "style",
  'link[rel="stylesheet"]',
  'link[rel="preload"]',
  'link[rel="modulepreload"]',
  'link[rel="prefetch"]',
  "nextjs-portal",
  "[data-nextjs-toast]",
  "[data-nextjs-dialog-overlay]",
  ".no-print",
].join(",");

/** Every stylesheet the page currently applies, as one CSS string. A sheet we
 *  cannot read (cross-origin) comes back as a <link> so the renderer can load
 *  it itself. */
function collectStyles(): { css: string; links: string[] } {
  const chunks: string[] = [];
  const links: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = (sheet as CSSStyleSheet).cssRules;
      const text = Array.from(rules).map((r) => r.cssText).join("\n");
      chunks.push(absolutizeUrls(text, sheet.href ?? document.baseURI));
    } catch {
      if (sheet.href) links.push(sheet.href);
    }
  }
  return { css: chunks.join("\n"), links };
}

/**
 * url() values inside a stylesheet resolve against THAT sheet's address, not
 * the document's. Next's CSS chunk lives under /_next/static/css/ and points
 * at its fonts as "../media/x.woff2"; once inlined into a <style> at the
 * document root that would resolve to /media/x.woff2, a 404, and every page
 * would print in the renderer's fallback font. Make every URL absolute first.
 */
function absolutizeUrls(css: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _q: string, raw: string) => {
    const value = raw.trim();
    if (/^(data:|blob:|#)/i.test(value)) return match;
    try {
      return `url("${new URL(value, base).href}")`;
    } catch {
      return match;
    }
  });
}

/** A static HTML document of the page as it is right now. */
export function capturePageHtml(title?: string, opts: { landscape?: boolean } = {}): string {
  const root = document.documentElement;
  const clone = root.cloneNode(true) as HTMLElement;

  // cloneNode copies attributes, not live form state. Carry the current value
  // of every field over (same order in both trees), then drop what won't print.
  const srcFields = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input, textarea, select",
  );
  const dstFields = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input, textarea, select",
  );
  srcFields.forEach((src, i) => {
    const dst = dstFields[i];
    if (!dst) return;
    if (src instanceof HTMLTextAreaElement) {
      dst.textContent = src.value;
    } else if (src instanceof HTMLSelectElement) {
      Array.from((dst as HTMLSelectElement).options).forEach((o, j) => {
        if (src.options[j]?.selected) o.setAttribute("selected", "");
        else o.removeAttribute("selected");
      });
    } else if (src.type === "checkbox" || src.type === "radio") {
      if (src.checked) dst.setAttribute("checked", "");
      else dst.removeAttribute("checked");
    } else {
      dst.setAttribute("value", src.value);
    }
  });

  // Canvases (charts) are pixels, not markup: bake each into an <img>.
  const srcCanvases = root.querySelectorAll("canvas");
  const dstCanvases = clone.querySelectorAll("canvas");
  srcCanvases.forEach((c, i) => {
    const dst = dstCanvases[i];
    if (!dst) return;
    try {
      const img = document.createElement("img");
      img.src = c.toDataURL("image/png");
      img.width = c.width;
      img.height = c.height;
      img.setAttribute("style", dst.getAttribute("style") ?? "");
      img.className = dst.className;
      dst.replaceWith(img);
    } catch {
      dst.remove();
    }
  });

  clone.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());

  const { css, links } = collectStyles();
  let head = clone.querySelector("head");
  if (!head) {
    head = document.createElement("head");
    clone.prepend(head);
  }
  head.replaceChildren();
  const meta = document.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  head.append(meta);
  const titleEl = document.createElement("title");
  titleEl.textContent = title ?? document.title;
  head.append(titleEl);
  for (const href of links) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    head.append(link);
  }
  const style = document.createElement("style");
  style.textContent = css;
  head.append(style);
  if (opts.landscape) {
    // Wide tables (the custom and invoices-period reports run ten columns)
    // clip on a portrait A4. globals.css pins @page to portrait A4, and the
    // renderer honors CSS page size, so the override has to be CSS too.
    const pageStyle = document.createElement("style");
    pageStyle.textContent = "@media print { @page { size: A4 landscape; margin: 12mm; } }";
    head.append(pageStyle);
  }

  return `<!DOCTYPE html>${clone.outerHTML}`;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function normalizeFilename(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "-").trim();
  return `${base || "report"}.pdf`;
}

/**
 * Snapshot the current page and download it as a PDF. Throws an Error whose
 * message is safe to show the user (Hebrew).
 */
export async function downloadCurrentPageAsPdf(opts: ReportPdfOptions): Promise<void> {
  const filename = normalizeFilename(opts.filename);
  const html = capturePageHtml(filename.replace(/\.pdf$/i, ""), { landscape: opts.landscape });
  await submitPageHtmlAsPdf(html, { ...opts, filename });
}

/**
 * Send an already-captured snapshot to the server and download the result.
 * Split out so a page can capture while a print-only sheet is mounted, tear
 * the sheet down, and only then wait on the network (see usePrintSheet).
 */
export async function submitPageHtmlAsPdf(html: string, opts: ReportPdfOptions): Promise<void> {
  const filename = normalizeFilename(opts.filename);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("פג תוקף ההתחברות, התחבר מחדש");
  }

  const res = await fetch("/api/reports/pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ html, filename, landscape: opts.landscape === true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const msg =
      err && typeof err.error === "string" ? err.error : `יצירת ה-PDF נכשלה (${res.status})`;
    throw new Error(msg);
  }

  saveBlob(await res.blob(), filename);
}

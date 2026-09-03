import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import { checkRate } from "@/lib/rate-limit";
import { launchPdfBrowser, safePdfFilename } from "@/lib/pdf-browser";

/**
 * POST /api/reports/pdf  { html, filename?, landscape? }  ->  application/pdf
 *
 * "Download PDF" for every report / list page. The browser's own Ctrl+P can
 * already print these pages, but that leaves the user in a print dialog
 * hunting for "Save as PDF". This route turns the same print layout into a
 * real .pdf file in one click.
 *
 * How it works: the client (src/lib/report-pdf.ts) snapshots the page it is
 * showing, with every stylesheet inlined, and posts that HTML here. We hand
 * it to headless Chrome, print with the page's own @media print rules, and
 * stream the PDF back. The output is byte-for-byte what the user would get
 * from Chrome's "Save as PDF", minus the dialog.
 *
 * Trust boundary: the HTML is user-supplied and rendered in a throwaway
 * headless browser that holds no cookies or credentials. Everything Chrome
 * may fetch while rendering is allow-listed (our own origin for fonts and
 * static assets, Google Fonts, the Supabase storage host for logos) and any
 * other request is aborted, so the page cannot be used to reach internal or
 * third-party hosts from our infrastructure.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// A report page with a few thousand rows plus inlined CSS is well under 2MB;
// Vercel caps request bodies at 4.5MB anyway. Anything bigger is not a report.
const MAX_HTML_BYTES = 3_500_000;

// Headless Chrome is the most expensive thing this app runs. A person clicks
// "download PDF" a handful of times an hour; a loop does not.
const RATE_MAX = 8;
const RATE_WINDOW_MS = 60_000;

const ALLOWED_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

async function userFromBearer(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

export async function POST(req: Request) {
  const user = await userFromBearer(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "נדרשת התחברות." }, { status: 401 });
  }

  const rl = checkRate({ key: `report-pdf:${user.id}`, max: RATE_MAX, windowMs: RATE_WINDOW_MS });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "יותר מדי הורדות בבת אחת. נסה שוב עוד רגע." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
    );
  }

  let body: { html?: unknown; filename?: unknown; landscape?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "בקשה לא תקינה." }, { status: 400 });
  }
  const html = typeof body.html === "string" ? body.html : "";
  if (!html || !/<html[\s>]/i.test(html) || !/<head[\s>]/i.test(html)) {
    return NextResponse.json({ ok: false, error: "בקשה לא תקינה." }, { status: 400 });
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return NextResponse.json(
      { ok: false, error: "הדוח גדול מדי להורדה כ-PDF. צמצם את הטווח ונסה שוב." },
      { status: 413 },
    );
  }
  const filename = safePdfFilename(typeof body.filename === "string" ? body.filename : "", "report");
  const landscape = body.landscape === true;

  // SSRF guard, same rule as the document PDF route: on Vercel (production
  // AND preview) relative URLs in the snapshot resolve against the trusted
  // canonical origin, never a request Host header. Only truly-local dev
  // (no VERCEL env) uses the request origin, so fonts come from localhost.
  const isVercel = !!process.env.VERCEL;
  const base = (() => {
    if (isVercel) return CANONICAL_ORIGIN;
    try {
      return new URL(req.url).origin;
    } catch {
      return CANONICAL_ORIGIN;
    }
  })();
  const allowedHosts = new Set(ALLOWED_HOSTS);
  try {
    allowedHosts.add(new URL(base).host);
    allowedHosts.add(new URL(supabaseUrl).host);
  } catch {
    // an unparsable origin only narrows the allow-list; rendering still works
  }

  // A <base> as the first head child wins over anything in the snapshot, so
  // every relative font / image / asset URL resolves against `base`.
  const doc = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="${base}/">`);

  let browser: Awaited<ReturnType<typeof launchPdfBrowser>> | null = null;
  try {
    browser = await launchPdfBrowser();
    const page = await browser.newPage();

    // The snapshot is static markup: the client strips every <script>, and
    // nothing in it needs to run. Turning scripts off closes the door on a
    // crafted payload doing anything at all inside the render.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    // The snapshot is served from a made-up path on OUR origin, fulfilled
    // right here from memory, instead of page.setContent(): setContent gives
    // the document an opaque ("null") origin, and web fonts are CORS-checked,
    // so every self-hosted font would be refused and the whole report would
    // print in the renderer's fallback face. Same-origin has no such check.
    const snapshotUrl = `${base}/__report-pdf__/${Date.now()}`;
    page.on("request", (r) => {
      const url = r.url();
      if (url === snapshotUrl) {
        void r.respond({ status: 200, contentType: "text/html; charset=utf-8", body: doc });
        return;
      }
      if (url.startsWith("data:")) {
        void r.continue();
        return;
      }
      let host = "";
      let protocol = "";
      try {
        const u = new URL(url);
        host = u.host;
        protocol = u.protocol;
      } catch {
        void r.abort();
        return;
      }
      const ok = (protocol === "https:" || (!isVercel && protocol === "http:")) && allowedHosts.has(host);
      if (ok) void r.continue();
      else void r.abort();
    });

    await page.setViewport({ width: 1280, height: 900 });
    try {
      await page.goto(snapshotUrl, { waitUntil: "load", timeout: 30_000 });
      await page.waitForNetworkIdle({ idleTime: 300, timeout: 15_000 });
    } catch (e) {
      // A font or image that never settles must not cost the user the PDF;
      // print whatever has rendered by now.
      console.warn("[report-pdf] setContent did not settle, printing anyway", e);
    }

    const pdf = await page.pdf({
      format: "A4",
      landscape,
      printBackground: true,
      // Honor the @page rules in globals.css (A4, 15mm margins) so the file
      // matches the browser's own "Save as PDF" verbatim.
      preferCSSPageSize: true,
    });

    const encoded = encodeURIComponent(filename);
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="report.pdf"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // Full detail stays server-side; never echo internals (paths, stack) back.
    console.error("[report-pdf] generation failed", { user: user.id, err });
    return NextResponse.json(
      { ok: false, error: "אירעה שגיאה ביצירת ה-PDF. נסה שוב." },
      { status: 500 },
    );
  } finally {
    if (browser) await browser.close();
  }
}

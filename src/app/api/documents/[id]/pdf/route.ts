import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";

// Headless-Chrome cold start + a full page render can take a while — give the
// serverless function real headroom so a slow cold boot doesn't 504.
export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Local dev / non-Vercel: fall back to a locally-installed Chrome so the route
// can be exercised without the bundled @sparticuz binary (which only ships a
// Linux build). On Vercel, chromium.executablePath() resolves the bundled one.
function localChromePath(): string | undefined {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean) as string[];
  return candidates[0];
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // Navigate Chrome to the app's own public /view page so the PDF reuses the
  // exact print CSS (RTL, print-color-adjust, page breaks, allocation number).
  // Prefer the canonical production origin; fall back to the request origin so
  // this still works on preview deploys / local dev.
  const base = (() => {
    if (process.env.VERCEL_ENV === "production") return CANONICAL_ORIGIN;
    try {
      return new URL(req.url).origin;
    } catch {
      return CANONICAL_ORIGIN;
    }
  })();
  const url = `${base}/view/${id}`;

  const isVercel = !!process.env.VERCEL;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(
      isVercel
        ? {
            args: chromium.args,
            executablePath: await chromium.executablePath(),
            headless: true,
          }
        : {
            // Local dev: use a system Chrome install.
            executablePath: localChromePath(),
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
          },
    );

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
    // The /view page fetches the document client-side, so wait for the rendered
    // document body before printing — otherwise the PDF captures the loader.
    await page.waitForSelector(".receipt-view", { timeout: 20_000 });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // Honor the @page rules in globals.css (A4, 15mm margins) so the output
      // matches the browser's own "Save as PDF" verbatim.
      preferCSSPageSize: true,
    });

    const filename = await buildFilename(id);
    const encoded = encodeURIComponent(filename);

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="document-${id.slice(0, 8)}.pdf"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "PDF generation failed" },
      { status: 500 },
    );
  } finally {
    if (browser) await browser.close();
  }
}

// A human-friendly Hebrew filename with the doc type + number, e.g.
// "חשבונית-מס-96.pdf". Best-effort: a service-role read fetches type/number;
// if that fails we still return a sane fallback.
async function buildFilename(id: string): Promise<string> {
  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const res = await admin
      .from("documents")
      .select("type, number")
      .eq("id", id)
      .maybeSingle();
    if (res.data) {
      const label = (DOCUMENT_TYPE_LABELS as Record<string, string>)[res.data.type] || "מסמך";
      const safe = `${label}-${res.data.number}`.replace(/[\\/:*?"<>|]/g, "-");
      return `${safe}.pdf`;
    }
  } catch {
    // fall through to the generic name
  }
  return `document-${id.slice(0, 8)}.pdf`;
}

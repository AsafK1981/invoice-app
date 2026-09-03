import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";
import { clientIp } from "@/lib/rate-limit";
import { launchPdfBrowser } from "@/lib/pdf-browser";

// Headless-Chrome cold start + a full page render can take a while; give the
// serverless function real headroom so a slow cold boot doesn't 504.
export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PDF generation spins up headless Chrome (~10s, memory-heavy), so it's far
// more expensive than a plain read. Keep the per-IP budget tight; a handful
// per minute is plenty for a human downloading their own documents, while a
// scripted abuser can't pin our function memory / rack up compute. Mirrors the
// inline per-IP limiter the other public routes use (public-document/approve).
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (rateLimitMap.size > 5000) {
      for (const [k, v] of rateLimitMap) {
        if (v.resetAt < now) rateLimitMap.delete(k);
      }
    }
    return { allowed: true, retryAfter: 0 };
  }
  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Rate-limit before doing any work: PDF generation is the most expensive
  // public operation we expose, so cap it per-IP up front.
  const ip = clientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "יותר מדי בקשות. נסה שוב עוד רגע." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const isVercel = !!process.env.VERCEL;

  // Cheap existence pre-check BEFORE launching Chrome. Any random UUID would
  // otherwise cold-boot headless Chrome (~10s, memory-heavy) just to render a
  // 404 /view page, a trivial DoS lever. A service-role SELECT id short-
  // circuits nonexistent ids in milliseconds. No new data exposure: the /view
  // page this PDF renders is already public by UUID.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const existsRes = await admin
    .from("documents")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existsRes.error || !existsRes.data) {
    return NextResponse.json({ ok: false, error: "המסמך לא נמצא." }, { status: 404 });
  }

  // Navigate Chrome to the app's own public /view page so the PDF reuses the
  // exact print CSS (RTL, print-color-adjust, page breaks, allocation number).
  // SSRF guard: on Vercel (production AND preview) always use the trusted
  // canonical origin, NEVER a request Host/X-Forwarded-Host header, which is
  // attacker-controllable and could point Chrome at an arbitrary host. Only
  // truly-local dev (no VERCEL env) falls back to the request origin. Combined
  // with the validated UUID, Chrome can only ever navigate to our own
  // canonical /view/<uuid> path.
  const base = (() => {
    if (isVercel) return CANONICAL_ORIGIN;
    try {
      return new URL(req.url).origin;
    } catch {
      return CANONICAL_ORIGIN;
    }
  })();
  // מקור/העתק passthrough: the caller decides which label the rendered PDF
  // should carry. Owner reprints request ?copy=1 (→ "העתק"); the customer's
  // download omits it (→ "מקור"). We only ever forward the boolean as an
  // explicit ?copy=1 onto our own validated canonical /view URL; no other part
  // of the request is trusted, so the SSRF guard above is unaffected.
  const wantCopy = new URL(req.url).searchParams.get("copy") === "1";
  const url = `${base}/view/${id}${wantCopy ? "?copy=1" : ""}`;

  // Chrome (~50MB binary + puppeteer-core) is loaded only now, once we know
  // the document exists and the request survived the rate limiter; see
  // src/lib/pdf-browser.ts.
  let browser: Awaited<ReturnType<typeof launchPdfBrowser>> | null = null;
  try {
    browser = await launchPdfBrowser();

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
    // The /view page fetches the document client-side, so wait for the rendered
    // document body before printing; otherwise the PDF captures the loader.
    await page.waitForSelector(".receipt-view", { timeout: 20_000 });
    // One document = one page: ReceiptView listens for beforeprint and shrinks
    // the sheet to A4 when its content runs past the page (src/lib/print-fit.ts).
    // Headless printToPDF does not reliably dispatch that event, so fire it
    // ourselves; the handler is idempotent if Chrome fires it again.
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // Honor the @page rules in globals.css (A4, 15mm margins) so the output
      // matches the browser's own "Save as PDF" verbatim.
      preferCSSPageSize: true,
    });

    // הוראות ניהול ספרים סעיף 18ב, render-then-set ordering: the PDF above was
    // rendered from /view while original_issued_at was still NULL, so THIS first
    // download reads "מקור". Now stamp it (idempotent, only while NULL) so the
    // NEXT download reads "העתק". Best-effort: never fail an already-produced PDF.
    try {
      await admin
        .from("documents")
        .update({ original_issued_at: new Date().toISOString() })
        .eq("id", id)
        .is("original_issued_at", null);
    } catch (stampErr) {
      console.error("[pdf] failed to stamp original_issued_at", { id, stampErr });
    }

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
    // Log the full error server-side only. NEVER leak internal detail to the
    // client, a past failure exposed the bundled chromium filesystem path.
    // The client-side caller falls back to window.print on any non-OK response.
    console.error("[pdf] generation failed", err);
    return NextResponse.json(
      { ok: false, error: "אירעה שגיאה ביצירת ה-PDF. נסה שוב." },
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

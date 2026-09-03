import type { Browser } from "puppeteer-core";

/**
 * One place that knows how to boot headless Chrome for PDF rendering.
 *
 * Shared by the document PDF route (/api/documents/[id]/pdf) and the report
 * PDF route (/api/reports/pdf). On Vercel it uses the bundled @sparticuz
 * binary; on a developer machine it falls back to a locally-installed Chrome
 * (the bundled one only ships a Linux build).
 *
 * The ~50MB chromium package and puppeteer-core are imported lazily, INSIDE
 * this function, so a route can reject a request (auth / rate limit / 404)
 * without ever paying the cold-start cost of loading them.
 */
export async function launchPdfBrowser(): Promise<Browser> {
  const isVercel = !!process.env.VERCEL;
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
    import("@sparticuz/chromium"),
    import("puppeteer-core"),
  ]);

  if (isVercel) {
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  return puppeteer.launch({
    executablePath: localChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

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

/**
 * Turn a human title into a filename Windows / macOS / Linux all accept.
 * Hebrew is kept as-is (browsers handle it via filename*); only the path
 * separators and reserved punctuation go.
 */
export function safePdfFilename(name: string, fallback = "report"): string {
  const base = name
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base || fallback}.pdf`;
}

// E2E for Phases 2 and 3 of the friendly filing reports on the Lynkeus QA tenant.
//   Uniform structure (/reports): run the check, fix the business number
//   inline with an 8-digit number (no leading zero), see the foreign client as
//   a collapsed note, download the ZIP when nothing blocks and check the
//   padded dealer number in INI.TXT and in the folder name.
//   Invoices-period: synthetic rows (a USD document without shekel amounts and
//   a duplicate number) injected into the browser's documents response through
//   CDP Fetch, no database write. Panel above the table, partial total, Excel
//   with the stamp, print stamp, PDF produced.
//   Desktop + mobile screenshots of both screens for reading.
//
//   BASE=http://localhost:3107 OUT=C:/Users/asafk/AppData/Local/Temp/filing-e2e-2 node scripts/qa-uniform-invoices-e2e.mjs
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { loadEnv } from "./lib/admin-core.mjs";

const BASE = process.env.BASE || "http://localhost:3107";
const OUT = process.env.OUT;
if (!OUT) {
  console.error("usage: OUT=<dir> [BASE=http://localhost:3107] node scripts/qa-uniform-invoices-e2e.mjs");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const env = loadEnv();
const keys = JSON.parse(fs.readFileSync("C:/Users/asafk/agents/lynkeus/state/keys.json", "utf8"));
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error: authError } = await anon.auth.signInWithPassword({ email: keys.email, password: keys.password });
if (authError || !auth.session) {
  console.error("QA sign-in failed");
  process.exit(1);
}
const storageKey = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchdog = setTimeout(() => {
  console.error("watchdog: E2E ran longer than 15 minutes");
  process.exit(2);
}, 900_000);

const DESKTOP = { width: 1440, height: 1000, deviceScaleFactor: 1 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const PANEL = '[data-testid="filing-fix-panel"]';
const UNIFORM = `#uniform-preflight ${PANEL}`;

// Synthetic invoices-period rows, dated the first of the current Israeli month
// (inside the page's default two-month preset). Ids are not UUIDs on purpose:
// they can never collide with a real row.
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const base = { date: `${month}-01`, type: "tax_invoice", status: "sent", client_id: null, client_tax_id: "", converted_to_id: null, allocation_number: null, rounding: 0, import_batch_id: null };
const synthetic = [
  { ...base, id: "qa-e2e-usd", number: 990001, client_name: "QA E2E USD", subtotal: 100, vat: 0, total: 100, currency: "USD", exchange_rate: 3.7, subtotal_ils: null, vat_ils: null, total_ils: null, zero_rated: true },
  { ...base, id: "qa-e2e-dup-a", number: 990002, client_name: "QA E2E", subtotal: 100, vat: 18, total: 118, currency: "ILS", exchange_rate: 1, subtotal_ils: 100, vat_ils: 18, total_ils: 118, zero_rated: false },
  { ...base, id: "qa-e2e-dup-b", number: 990002, client_name: "QA E2E", subtotal: 100, vat: 18, total: 118, currency: "ILS", exchange_rate: 1, subtotal_ils: 100, vat_ils: 18, total_ils: 118, zero_rated: false },
];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  userDataDir: path.join(OUT, `profile-${process.pid}`),
  args: ["--no-first-run", "--disable-extensions"],
});

try {
  const page = await browser.newPage();

  // Every download in this app goes through URL.createObjectURL: keep the blobs to read them back.
  await page.evaluateOnNewDocument(() => {
    window.__blobs = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob) window.__blobs.push(blob);
      return original(blob);
    };
  });
  async function captureBlob(typePrefix, click) {
    await page.evaluate(() => { window.__blobs = []; });
    await click();
    await page.waitForFunction((t) => window.__blobs.some((b) => b.type.startsWith(t)), { timeout: 120_000 }, typePrefix);
    const base64 = await page.evaluate(async (t) => {
      const blob = window.__blobs.find((b) => b.type.startsWith(t));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    }, typePrefix);
    return Buffer.from(base64, "base64");
  }

  async function settle(viewport, selector) {
    await page.waitForFunction((w) => window.innerWidth === w, { timeout: 10_000 }, viewport.width);
    await page.$eval(selector, (el) => el.scrollIntoView({ block: "start" }));
    await sleep(1200);
  }
  const itemCodes = (scope) => page.$$eval(`${scope} [data-fix-code]`, (els) => els.map((el) => `${el.getAttribute("data-fix-code")}/${el.getAttribute("data-fix-tier")}`));
  async function fixInline(scope, code, label, value) {
    const selector = `${scope} [data-fix-code="${code}"] input[aria-label="${label}"]`;
    const input = await page.waitForSelector(selector, { timeout: 30_000 });
    // Clear by keyboard, not triple-click (puppeteer 25 renamed clickCount).
    await input.click();
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await input.type(value);
    await (await page.$(`${scope} [data-fix-code="${code}"] [data-fix-save]`)).click();
    await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 120_000 }, selector);
  }
  async function step(label, fn) {
    try {
      await fn();
      check(true, label);
    } catch (err) {
      check(false, `${label}: ${err instanceof Error ? err.message : err}`);
    }
  }

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.evaluate((key, value) => localStorage.setItem(key, value), storageKey, JSON.stringify(auth.session));

  // ---------- uniform structure ----------
  async function openUniform(viewport) {
    await page.setViewport(viewport);
    await page.goto(`${BASE}/reports`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    const card = await page.waitForFunction(() => [...document.querySelectorAll("button.rpt-rc")].find((b) => b.textContent.includes("OPENFORMAT")), { timeout: 240_000 });
    await card.asElement().click();
    await page.waitForSelector(UNIFORM, { timeout: 240_000 });
    await settle(viewport, "#uniform-preflight");
  }

  await openUniform(DESKTOP);
  const before = await itemCodes("#uniform-preflight");
  console.log("uniform items before:", before.join(","));
  check(before.includes("dealer_number_invalid/blocking"), "an empty business number is a blocking item with an inline field");
  await page.screenshot({ path: path.join(OUT, "uniform-desktop-before.png") });
  await openUniform(MOBILE);
  await page.screenshot({ path: path.join(OUT, "uniform-mobile-before.png") });

  await openUniform(DESKTOP);
  await step("business number fixed inline with 8 digits re-checks and unblocks it", () => fixInline("#uniform-preflight", "dealer_number_invalid", "מספר העוסק של העסק", "13333331"));
  await sleep(1500);
  const after = await itemCodes("#uniform-preflight");
  console.log("uniform items after:", after.join(","));
  check(!after.some((c) => c.startsWith("dealer_number_invalid")), "an 8-digit business number no longer blocks");
  await step("the foreign-id client is a collapsed note", async () => {
    await (await page.waitForSelector(`${UNIFORM} button[aria-expanded]`, { timeout: 15_000 })).click();
    await page.waitForSelector(`${UNIFORM} [data-fix-code="client_number_not_israeli"][data-fix-tier="note"]`, { timeout: 15_000 });
  });
  await page.$eval("#uniform-preflight", (el) => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(OUT, "uniform-desktop-after.png") });

  const blocking = (await itemCodes("#uniform-preflight")).filter((c) => c.endsWith("/blocking"));
  if (blocking.length === 0) {
    await step("ZIP downloads with the padded dealer number", async () => {
      const zipBytes = await captureBlob("application/zip", async () => {
        await (await page.waitForSelector('[data-testid="uniform-download"]:not([disabled])', { timeout: 30_000 })).click();
      });
      const zip = await JSZip.loadAsync(zipBytes);
      const iniName = Object.keys(zip.files).find((name) => /^OPENFRMT\/01333333\.\d{2}\/\d{8}\/INI\.TXT$/.test(name));
      if (!iniName) throw new Error(`no INI.TXT under OPENFRMT/01333333.YY (${Object.keys(zip.files).length} entries)`);
      const ini = Buffer.from(await zip.file(iniName).async("uint8array")).toString("latin1");
      if (ini.slice(24, 33) !== "013333331") throw new Error("INI dealer field is not the padded number");
    });
  } else {
    check(false, `uniform check still blocks on QA data, codes: ${blocking.join(",")}`);
  }
  await openUniform(MOBILE);
  await page.screenshot({ path: path.join(OUT, "uniform-mobile-after.png") });

  // ---------- invoices-period ----------
  const fetchSession = await page.target().createCDPSession();
  let injected = 0;
  fetchSession.on("Fetch.requestPaused", async (event) => {
    try {
      const status = event.responseStatusCode ?? 0;
      const select = new URL(event.request.url).searchParams.get("select") ?? "";
      if (event.request.method !== "GET" || !select.includes("import_batch_id") || (status !== 200 && status !== 206)) {
        await fetchSession.send("Fetch.continueRequest", { requestId: event.requestId });
        return;
      }
      const { body, base64Encoded } = await fetchSession.send("Fetch.getResponseBody", { requestId: event.requestId });
      const rows = JSON.parse(base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body);
      const original = event.responseHeaders ?? [];
      const range = original.find((h) => h.name.toLowerCase() === "content-range")?.value ?? "";
      const total = Number(/\/(\d+)$/.exec(range)?.[1] ?? rows.length);
      // Single page only (the report pages by 500 and the QA tenant has fewer rows).
      const next = total === rows.length ? [...rows, ...synthetic] : rows;
      if (next !== rows) injected += 1;
      const headers = original.filter((h) => !["content-range", "content-length", "content-encoding"].includes(h.name.toLowerCase()));
      headers.push({ name: "Content-Range", value: next.length ? `0-${next.length - 1}/${total === rows.length ? next.length : total}` : "*/0" });
      await fetchSession.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: status, responseHeaders: headers, body: Buffer.from(JSON.stringify(next)).toString("base64") });
    } catch {
      await fetchSession.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => {});
    }
  });
  await fetchSession.send("Fetch.enable", { patterns: [{ urlPattern: "*/rest/v1/documents*", requestStage: "Response" }] });

  async function openInvoices(viewport) {
    await page.setViewport(viewport);
    await page.goto(`${BASE}/reports/invoices-period`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await page.waitForSelector(PANEL, { timeout: 240_000 });
    await settle(viewport, PANEL);
  }

  await openInvoices(DESKTOP);
  check(injected > 0, "synthetic rows were injected into the documents response");
  const invoiceItems = await itemCodes("body");
  console.log("invoices-period items:", invoiceItems.join(","));
  check(invoiceItems.includes("foreign_currency_missing_ils/action"), "a USD document without shekel amounts is a visible item");
  check(invoiceItems.includes("duplicate_number/action"), "a duplicate document number is a visible item");
  const headline = await page.$eval(`${PANEL} [role="status"]`, (el) => el.textContent.trim());
  check(headline.includes("משפיע"), `the headline says the totals are affected (got "${headline}")`);
  check((await page.$eval("tfoot", (el) => el.textContent)).includes("חלקי"), "the total row is marked partial");
  check((await page.$eval("tbody", (el) => el.textContent)).includes("חסר בשקלים"), "the missing amounts are shown, not zero");
  await page.screenshot({ path: path.join(OUT, "invoices-desktop.png"), fullPage: true });

  await step("Excel downloads with the partial total and the notes", async () => {
    const bytes = await captureBlob("application/vnd.openxmlformats", async () => {
      const button = await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("ייצוא Excel") && !b.disabled), { timeout: 30_000 });
      await button.asElement().click();
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const values = [];
    wb.getWorksheet("חשבוניות").eachRow((row) => row.eachCell((cell) => values.push(String(cell.value?.result ?? cell.value ?? ""))));
    if (!values.includes("סה״כ (חלקי)")) throw new Error("no partial total label");
    if (!values.includes("הערות לדוח:")) throw new Error("no notes section");
  });
  await step("the stamp is visible in print media", async () => {
    await page.emulateMediaType("print");
    const shown = await page.$eval('[data-testid="invoice-report-stamp"]', (el) => getComputedStyle(el).display !== "none");
    await page.emulateMediaType("screen");
    if (!shown) throw new Error("stamp hidden in print");
  });
  await step("PDF is produced", async () => {
    const bytes = await captureBlob("application/pdf", async () => {
      const button = await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("הורדת PDF") && !b.disabled), { timeout: 30_000 });
      await button.asElement().click();
    });
    if (bytes.length < 1000 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("not a PDF");
  });
  await openInvoices(MOBILE);
  await page.screenshot({ path: path.join(OUT, "invoices-mobile.png"), fullPage: true });
} finally {
  clearTimeout(watchdog);
  await browser.close().catch(() => {});
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS");
process.exitCode = failures.length ? 1 : 0;

// E2E for the friendly filing report on the Lynkeus QA tenant: session
// injection, fix the business number and a grouped supplier number inline on
// /reports/vat, download the PCN874 file and check it, save the allocation
// number, check the yearly view's friendly period item, and write desktop +
// mobile screenshots for reading.
//
//   BASE=http://localhost:3107 OUT=C:/Users/asafk/AppData/Local/Temp/filing-e2e node scripts/qa-filing-fix-e2e.mjs
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import { loadEnv } from "./lib/admin-core.mjs";

const BASE = process.env.BASE || "http://localhost:3107";
const OUT = process.env.OUT;
if (!OUT) {
  console.error("usage: OUT=<dir> [BASE=http://localhost:3107] node scripts/qa-filing-fix-e2e.mjs");
  process.exit(1);
}
const downloads = path.join(OUT, "downloads");
fs.mkdirSync(downloads, { recursive: true });

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
  console.error("watchdog: E2E ran longer than 12 minutes");
  process.exit(2);
}, 720_000);

const DESKTOP = { width: 1440, height: 1000, deviceScaleFactor: 1 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const PANEL = '[data-testid="filing-fix-panel"]';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  userDataDir: path.join(OUT, `profile-${process.pid}`),
  args: ["--no-first-run", "--disable-extensions"],
});

try {
  const page = await browser.newPage();
  const cdp = await browser.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });

  async function open(viewport, period = "last_2m") {
    await page.setViewport(viewport);
    await page.goto(`${BASE}/reports/vat?period=${period}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await page.waitForSelector(PANEL, { timeout: 240_000 });
    // Lynkeus lesson: never shoot before the viewport has really settled.
    await page.waitForFunction((w) => window.innerWidth === w, { timeout: 10_000 }, viewport.width);
    await page.$eval(PANEL, (el) => el.scrollIntoView({ block: "start" }));
    await sleep(1200);
  }
  const status = () => page.$eval(`${PANEL} [role="status"]`, (el) => el.textContent.trim());
  async function fixInline(code, label, value) {
    const selector = `[data-fix-code="${code}"] input[aria-label="${label}"]`;
    const input = await page.waitForSelector(selector, { timeout: 30_000 });
    // Clear by value, not by triple-click: puppeteer 25 renamed clickCount, so a
    // triple-click silently appends to the existing number.
    await input.click();
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await input.type(value);
    const save = await page.$(`[data-fix-code="${code}"] [data-fix-save]`);
    await save.click();
    await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 90_000 }, selector);
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

  await open(DESKTOP);
  console.log("status before:", await status());
  console.log("fix codes before:", await page.$$eval("[data-fix-code]", (els) => els.map((el) => el.getAttribute("data-fix-code")).join(",")));
  await page.screenshot({ path: path.join(OUT, "desktop-before.png") });
  const groupText = await page.$eval('[data-fix-code="supplier_number_invalid"]', (el) => el.textContent).catch(() => "");
  check(groupText.includes("2 הוצאות"), "two expenses of one supplier are one item");
  check(Boolean(await page.$('[data-fix-code="supplier_allocation_missing"]')), "input without an allocation number is a visible item");

  await open(MOBILE);
  await page.screenshot({ path: path.join(OUT, "mobile-before.png") });

  await open(DESKTOP);
  await step("business number fixed inline", () => fixInline("dealer_number_invalid", "מספר העוסק של העסק", "512345679"));
  await step("supplier number fixed inline for both expenses", () => fixInline("supplier_number_invalid", "מספר עוסק של הספק", "513333336"));
  await sleep(1500);
  const after = await status();
  check(after === "הכל מוכן", `panel reports ready (got "${after}")`);

  await step("PCN874 file downloads with the fixed numbers", async () => {
    const button = await page.waitForSelector('[data-testid="pcn874-download"]:not([disabled])', { timeout: 60_000 });
    await button.click();
    const deadline = Date.now() + 30_000;
    let file;
    while (!file && Date.now() < deadline) {
      file = fs.readdirSync(downloads).find((name) => /^PCN874_\d{9}_\d{6}\.txt$/.test(name));
      if (!file) await sleep(500);
    }
    if (!file) throw new Error("no PCN874 file in downloads");
    const lines = fs.readFileSync(path.join(downloads, file), "latin1").split("\r\n");
    if (!lines[0].startsWith("O512345679")) throw new Error("header does not carry the fixed business number");
    if (!lines.some((l) => l.startsWith("T513333336"))) throw new Error("no T record with the fixed supplier number");
    if (lines.some((l) => l.startsWith("T514993666"))) throw new Error("the input without an allocation number is in the file");
  });

  await page.$eval(PANEL, (el) => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(OUT, "desktop-after-fixes.png") });
  await step("allocation number restores the input", () => fixInline("supplier_allocation_missing", "מספר הקצאה", "111222333"));
  await page.$eval(PANEL, (el) => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(OUT, "desktop-after-allocation.png") });
  await open(MOBILE);
  await page.screenshot({ path: path.join(OUT, "mobile-after.png") });

  await open(DESKTOP, "this_year");
  await step("the yearly view shows one friendly period item", async () => {
    const codes = await page.$$eval("[data-fix-code]", (els) => els.map((el) => el.getAttribute("data-fix-code")));
    if (codes.join(",") !== "period_length") throw new Error(`items: ${codes.join(",")}`);
  });
  await page.screenshot({ path: path.join(OUT, "desktop-year.png") });
  await open(MOBILE, "this_year");
  await page.screenshot({ path: path.join(OUT, "mobile-year.png") });
  await step("the period button switches to the last ended bi-monthly period", async () => {
    await (await page.waitForSelector("[data-fix-period]")).click();
    await page.waitForFunction(() => location.search.includes("period=last_2m"), { timeout: 10_000 });
  });
} finally {
  clearTimeout(watchdog);
  await browser.close().catch(() => {});
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS");
process.exitCode = failures.length ? 1 : 0;

#!/usr/bin/env node
// Weekly watch for the Tax Authority's yearly deadline calendar ("קביעת מועדי
// הדיווח והתשלום - דוחות תקופתיים מע"מ, מקדמות מס הכנסה וניכויים - שנת המס
// YYYY"). The /obligations calendar, the periodic report and the reminder cron
// read those dates from OFFICIAL_DEADLINES in src/lib/ita/filing-calendar.ts;
// without next year's table they fall back to the statutory day and cannot
// know the holiday shifts. The notice comes out between October and December.
//
// Every Sunday (Windows task "invoice-app-ita-calendar-watch"):
//  1. Which tax year must be covered (next year from October).
//  2. If the app does not have it yet: search gov.il for the notice, read its
//     table, sanity-check it, save it to work/ita-calendar/<year>.json with a
//     ready-to-paste TypeScript snippet, and send ONE WhatsApp through Gaya
//     telling Asaf to ask Claude to apply it. From 1 December, if it is still
//     not published, ONE warning instead.
//  3. Any postponement notice ("דחיית מועדי הדיווח") for this year gets ONE
//     WhatsApp too: a one-off war or strike delay is not in the yearly table.
// Zero-noise: each message is claimed once through Gaya /watch-claim.
//
// Runs LOCALLY in a real Chrome window placed off-screen: gov.il is behind
// Cloudflare, which blocks fetch and headless browsers but not a normal Chrome
// (verified 2026-09-15). The app never updates itself from this: dates that
// drive tax deadlines are applied by a reviewed commit.
//
// Usage: node scripts/watch-ita-calendar.mjs [--dry-run]

import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coveredMonths, findNotice, findPostponements, parseNoticeTable, targetYear, tsSnippet, validateRows } from "./lib/ita-calendar.mjs";

const ROOT = new URL("..", import.meta.url);
let fileEnv = {};
try {
  fileEnv = readFileSync(new URL(".env.local", ROOT), "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .reduce((a, l) => {
      const [k, ...r] = l.split("=");
      if (k) a[k.trim()] = r.join("=").trim();
      return a;
    }, {});
} catch {}
const GAYA_TOKEN = process.env.GAYA_PUSH_TOKEN || fileEnv.GAYA_PUSH_TOKEN;
const GAYA_BASE = "https://136.111.197.22.nip.io";
const SOURCE = "ita-calendar-watch";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DRY = process.argv.includes("--dry-run");

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMPTY_PAGE = JSON.stringify({ text: "", links: [] });

/**
 * Open `url` in a real, off-screen Chrome and return { text, links } once
 * `ready` says the page has rendered what we need. gov.il pages paint their
 * navigation first and the content (search results, the notice table) a
 * moment later, so "some text is there" is not enough.
 */
async function readPage(url, ready) {
  const port = 9700 + (process.pid % 200);
  const profile = mkdtempSync(join(tmpdir(), "ita-watch-"));
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--window-position=-2400,-2400", "--window-size=1200,900", "about:blank",
  ], { stdio: "ignore" });
  try {
    let targets = [];
    for (let i = 0; i < 60; i++) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        if (targets.some((t) => t.type === "page")) break;
      } catch {}
      await sleep(250);
    }
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("Chrome did not start");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    });
    const send = (method, params = {}) => new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    await send("Page.enable");
    await send("Page.navigate", { url });
    const expression =
      "JSON.stringify({ text: document.body ? document.body.innerText : '', links: [...document.querySelectorAll('a')].map(a => [a.href, (a.innerText || '').trim()]).filter(x => x[1]) })";
    let result = { text: "", links: [] };
    for (let i = 0; i < 30; i++) {
      await sleep(1500);
      const r = await send("Runtime.evaluate", { expression, returnByValue: true });
      result = JSON.parse(r.result?.result?.value || EMPTY_PAGE);
      if (/you have been blocked/i.test(result.text)) break;
      if (!/Just a moment|enable cookies/i.test(result.text) && ready(result)) break;
    }
    ws.close();
    if (/you have been blocked/i.test(result.text)) throw new Error(`gov.il blocked the browser on ${url}`);
    return result;
  } finally {
    chrome.kill();
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
}

async function claimFirstTime(id) {
  if (DRY) return true;
  if (!GAYA_TOKEN) {
    console.error("GAYA_PUSH_TOKEN missing; failing CLOSED (no push)");
    return false;
  }
  try {
    const res = await fetch(`${GAYA_BASE}/watch-claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${GAYA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: SOURCE, id }),
    });
    if (!res.ok) {
      console.error(`watch-claim returned ${res.status}; failing CLOSED`);
      return false;
    }
    return (await res.json()).first === true;
  } catch (err) {
    console.error(`watch-claim error: ${err.message}; failing CLOSED`);
    return false;
  }
}

async function push(id, text) {
  if (DRY) {
    console.log(`[dry-run] would push (${id}):\n${text}`);
    return;
  }
  if (!(await claimFirstTime(id))) {
    console.log(`already sent (${id}) or claim failed; skipping`);
    return;
  }
  // Time-sensitive tax dates: deliver now, not in the evening digest.
  const res = await fetch(`${GAYA_BASE}/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${GAYA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, source: "invoice-app", urgent: true }),
  });
  console.log(`push ${id}: ${res.status} ${(await res.text()).slice(0, 160)}`);
}

/**
 * The calendar file as it is on production (origin/master), not as it happens
 * to be in this checkout: the task runs from a long-lived worktree, and once a
 * reviewed commit adds next year's table the watcher must see it without anyone
 * updating that worktree. Falls back to the local file when git is unavailable.
 */
function productionCalendarSource() {
  const cwd = fileURLToPath(ROOT);
  try {
    execFileSync("git", ["fetch", "--quiet", "origin", "master"], { cwd, stdio: "ignore", timeout: 60000 });
    return execFileSync("git", ["show", "origin/master:src/lib/ita/filing-calendar.ts"], { cwd, encoding: "utf8", timeout: 30000 });
  } catch (err) {
    console.warn(`could not read origin/master (${err.message}); using the local file`);
    return readFileSync(new URL("src/lib/ita/filing-calendar.ts", ROOT), "utf8");
  }
}

async function main() {
  const forcedYear = process.argv.find((a) => a.startsWith("--year="));
  const year = forcedYear ? Number(forcedYear.slice(7)) : targetYear(today);
  const calendarSource = productionCalendarSource();
  const covered = coveredMonths(calendarSource).filter((m) => m.startsWith(`${year}-`));
  console.log(`today ${today}; target tax year ${year}; app covers ${covered.length}/12 months`);

  const query = encodeURIComponent(`קביעת מועדי הדיווח והתשלום ${year}`);
  // Results are ready when at least one publication link is listed; a search
  // with genuinely no hits still ends after the loop's time limit.
  const search = await readPage(`https://www.gov.il/he/search?query=${query}`, (page) =>
    page.links.some(([href]) => /\/(publications|pages)\//i.test(href) && !/gov_terms_of_use|accessibility/i.test(href)),
  );
  const resultLinks = search.links.filter(([href]) => /\/(publications|pages)\//i.test(href));
  console.log(`search returned ${search.links.length} links, ${resultLinks.length} publication links`);
  if (resultLinks.length === 0) throw new Error("gov.il search showed no results (page did not load or the search changed)");

  for (const p of findPostponements(search.links, year)) {
    await push(
      `postpone:${p.href}`,
      `[חשבונית ידידותית] רשות המסים פרסמה הודעה על דחיית מועדים: "${p.title}". בדוק אם זה משנה את התאריכים בלוח חובות ההגשה, ואם כן תגיד ל-Claude לעדכן.\n${p.href}`,
    );
  }

  if (covered.length === 12 && !process.argv.includes("--force")) {
    console.log("already covered; nothing to do");
    return;
  }

  const notice = findNotice(search.links, year);
  if (!notice) {
    console.log(`notice for ${year} not found yet`);
    if (today >= `${year - 1}-12-01`) {
      await push(
        `missing:${year}`,
        `[חשבונית ידידותית] לוח מועדי הדיווח של רשות המסים לשנת ${year} עוד לא נמצא באתר gov.il. עד שיפורסם, לוח חובות ההגשה מציג את המועד לפי החוק בלי דחיות חגים. אבדוק שוב כל שבוע.`,
      );
    }
    return;
  }

  console.log(`found: ${notice.title} ${notice.href}`);
  // The notice is ready once the table's first rows (month name + a date) are on the page.
  const page = await readPage(notice.href, (p) => parseNoticeTable(p.text, year).missing.length < 12);
  const { rows, missing } = parseNoticeTable(page.text, year);
  const problems = validateRows(rows);
  const outDir = new URL("work/ita-calendar/", ROOT);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(new URL(`${year}.json`, outDir), JSON.stringify({ year, source: notice.href, title: notice.title, readOn: today, rows, missing, problems }, null, 2));
  writeFileSync(new URL(`${year}.ts-snippet.txt`, outDir), `${tsSnippet(rows)}\n`);
  writeFileSync(new URL(`${year}.page.txt`, outDir), page.text);
  console.log(`parsed ${Object.keys(rows).length} rows, missing ${missing.length}, problems ${problems.length}`);

  const quality =
    missing.length === 0 && problems.length === 0
      ? "כל 12 החודשים נקראו ועברו בדיקת תקינות."
      : `שים לב: ${missing.length} חודשים לא נקראו ו-${problems.length} שורות נראות חשודות, צריך לבדוק ידנית.`;
  await push(
    `notice:${year}`,
    `[חשבונית ידידותית] רשות המסים פרסמה את לוח מועדי הדיווח לשנת ${year}. ${quality} הטבלה שמורה בפרויקט (work/ita-calendar/${year}.json). כדי שהאפליקציה תשתמש בה, תגיד ל-Claude: "עדכן את לוח המועדים של רשות המסים ל-${year}".\n${notice.href}`,
  );
}

main().catch(async (err) => {
  console.error(err);
  // A broken watcher must not go quiet for a whole season: one alert per ISO week at most.
  const d = new Date();
  const week = `${d.getUTCFullYear()}-${Math.ceil(((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7)}`;
  await push(`error:${week}`, `[חשבונית ידידותית] בדיקת לוח המועדים של רשות המסים נכשלה: ${String(err.message || err).slice(0, 200)}`).catch(() => {});
  process.exit(1);
});

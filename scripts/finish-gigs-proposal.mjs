#!/usr/bin/env node
/**
 * "הופעות עם פיניש" monthly invoice proposal.
 *
 * Reads the newest `* פיניש כספים.xlsx` in the gigs folder, finds the gigs of
 * a billing period that have NOT been invoiced yet, and posts a single
 * proposal to /api/proposals. The app shows it on the dashboard with an
 * approve button; nothing is ever issued without that click.
 *
 * Why a local script and not a server integration: the workbook lives on the
 * owner's PC and is maintained by hand (and by Claude). Reading it here means
 * no Google OAuth, no upload step, and no copy of the file in the cloud.
 *
 * The sheet (`Sheet1`) has a header row and one row per gig:
 *   B index | C date | D venue | E invoiced? | F bill-to | G amount |
 *   H for-what | I payment date | J paid? | K year | L month
 * Interleaved "סיכום <year>" / total rows are skipped by requiring both a
 * parseable date in C and a bill-to name in F.
 *
 * Usage:
 *   node scripts/finish-gigs-proposal.mjs              # bills last month
 *   node scripts/finish-gigs-proposal.mjs --period 2026-08
 *   node scripts/finish-gigs-proposal.mjs --dry-run    # print, post nothing
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

// ---------------------------------------------------------------- config ---

const GIGS_DIR = "C:/Users/asafk/OneDrive/Desktop/Desktop/Asaf/2026/\u05e4\u05d9\u05e0\u05d9\u05e9";
const SOURCE = "finish-gigs";
const SOURCE_LABEL = "\u05e7\u05d5\u05d1\u05e5 \u05d4\u05d4\u05d5\u05e4\u05e2\u05d5\u05ea \u05e9\u05dc \u05e4\u05d9\u05e0\u05d9\u05e9";
const BUSINESS_ID = "dc3b5b61-7de6-435a-8034-5f93cbfb090b";
const CLIENT_ID = "d1d3f1db-82af-444f-bf86-10f1050f56ce";
const CLIENT_NAME = 'טים טדי בע"מ';
// עוסק פטור: the month-opening document is a חשבון עסקה, and the receipt
// follows when the money lands. This mirrors every 2026 invoice in the app.
const DOCUMENT_TYPE = "proforma";

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

// Column indexes in the header:1-based array produced by sheet_to_json.
const COL = { DATE: 2, VENUE: 3, INVOICED: 4, BILL_TO: 5, AMOUNT: 6, FOR_WHAT: 7 };

// ------------------------------------------------------------------ env ----

function readEnv() {
  const file = path.join(ROOT, ".env.local");
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

// --------------------------------------------------------------- parsing ---

/**
 * The date column is mostly real Excel dates but at least one row is the
 * string "30/07/2026" (typed by hand). Both must parse or that gig silently
 * drops out of its month and never gets billed.
 */
function parseCellDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // cellDates gives a local-midnight Date; read the local parts, not UTC,
    // or a gig on the 1st slides into the previous month.
    return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (m) {
      const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
      return { y: year, m: Number(m[2]), d: Number(m[1]) };
    }
    return null;
  }
  // A cell whose number format was cleared comes through as a raw Excel
  // serial (days since 1899-12-30) even with cellDates:true. Dropping it
  // would silently remove a real gig from its month.
  if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) {
    const ms = Math.round(v) * 86400000 + Date.UTC(1899, 11, 30);
    const d = new Date(ms);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  return null;
}

const periodOf = (dt) => `${dt.y}-${String(dt.m).padStart(2, "0")}`;
const round2 = (n) => Math.round(n * 100) / 100;
const norm = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

function newestWorkbook(dir) {
  if (!fs.existsSync(dir)) throw new Error(`Gigs folder not found: ${dir}`);
  const files = fs
    .readdirSync(dir)
    // ".~lock.*.xlsx#" files are LibreOffice locks, not workbooks.
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~") && !f.startsWith("."))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) throw new Error(`No .xlsx in ${dir}`);
  return { file: path.join(dir, files[0].name), name: files[0].name, mtime: files[0].mtime };
}

function readGigs(file) {
  // readFile() cannot open a path with Hebrew in it on this machine; read the
  // bytes ourselves and hand XLSX a buffer.
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: true });
  const sheet = wb.Sheets["Sheet1"] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });

  const gigs = [];
  const skipped = [];
  const oddFlags = [];
  const undated = [];
  for (const row of rows) {
    const date = parseCellDate(row[COL.DATE]);
    const billTo = norm(row[COL.BILL_TO]);
    const amount = Number(row[COL.AMOUNT]);
    // A real gig row needs a date AND a bill-to. Summary rows ("סיכום 2025",
    // "סה"כ הכנסה כולל") have at most one of the two and drop out here.
    if (!billTo) continue;
    if (!date) {
      // Has a payer but no readable date: a real gig row we cannot place in a
      // month. Never silently dropped - that is an under-bill.
      const rawAmount = Number(row[COL.AMOUNT]);
      if (Number.isFinite(rawAmount) && rawAmount > 0) {
        undated.push({ venue: norm(row[COL.VENUE]), raw: norm(row[COL.DATE]), amount: rawAmount });
      }
      continue;
    }
    // Looks like a gig but the money is unusable (blank, text, negative).
    // Reported, never silently dropped: a swallowed row is an under-bill.
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped.push({ date, venue: norm(row[COL.VENUE]), raw: norm(row[COL.AMOUNT]) });
      continue;
    }
    const invoicedRaw = norm(row[COL.INVOICED]);
    if (invoicedRaw && invoicedRaw !== "כן" && invoicedRaw !== "לא") {
      oddFlags.push({ date, venue: norm(row[COL.VENUE]), raw: invoicedRaw });
    }
    gigs.push({
      date,
      period: periodOf(date),
      venue: norm(row[COL.VENUE]),
      invoiced: invoicedRaw === "כן",
      billTo,
      amount: round2(amount),
      forWhat: norm(row[COL.FOR_WHAT]),
    });
  }
  return { gigs, skipped, oddFlags, undated };
}

/**
 * Turn a month's gigs into invoice lines.
 *
 * Playing fees are grouped by their per-gig price, which is how these
 * invoices have always been written (one line, quantity = number of gigs).
 * Anything that is not a playing fee - a keyboard stand, an expense refund -
 * gets its own line at quantity 1 rather than being folded into the average,
 * because folding it in would misstate both the per-gig rate and the count.
 */
function buildItems(gigs, period) {
  const [year, month] = period.split("-").map(Number);
  const label = `הופעות עם פיניש - ${HEBREW_MONTHS[month - 1]} ${year}`;

  const isPlaying = (g) => g.forWhat.includes("נגינה");
  const playing = gigs.filter(isPlaying);
  const other = gigs.filter((g) => !isPlaying(g));

  const byPrice = new Map();
  for (const g of playing) {
    if (!byPrice.has(g.amount)) byPrice.set(g.amount, []);
    byPrice.get(g.amount).push(g);
  }

  const items = [];
  const prices = [...byPrice.keys()].sort((a, b) => b - a);
  for (const price of prices) {
    const group = byPrice.get(price);
    items.push({
      // With a single rate the description is the plain subject, exactly as
      // these invoices have always read. With mixed rates each line has to
      // say its rate or the invoice can't be reconciled against the lines.
      description: prices.length === 1 ? label : `${label} (${price} ₪ להופעה)`,
      quantity: group.length,
      unitPrice: price,
      total: round2(group.length * price),
    });
  }
  for (const g of other) {
    items.push({
      description: g.forWhat || "שונות",
      quantity: 1,
      unitPrice: g.amount,
      total: g.amount,
    });
  }
  return { items, subject: label };
}

/**
 * WhatsApp via Gaya. Best-effort: a failed push must not fail the run - the
 * proposal is already saved and the in-app notification already fired.
 */
async function pushToGaya(text) {
  try {
    const tokenFile = path.join(os.homedir(), ".claude", ".gaya-push-token");
    if (!fs.existsSync(tokenFile)) return;
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    if (!token) return;
    const res = await fetch("https://136.111.197.22.nip.io/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, source: "invoice-app", urgent: true }),
    });
    const body = await res.json().catch(() => ({}));
    console.log(body.queued ? "(הודעת וואטסאפ נכנסה לתור הדייג'סט)" : "(הודעת וואטסאפ נשלחה)");
  } catch (err) {
    console.warn("push failed (non-fatal):", err.message);
  }
}

/**
 * The הערות block: one line per gig, in the format Asaf writes by hand every
 * month. Verified against documents #90002-#90005 and their receipts:
 *
 *   DD/MM/YYYY<TAB>venue<TAB>1550.00 = נגינה (1200 שח) + נהיגה (350 שח)
 *
 * The client is used to seeing this breakdown; an invoice without it is not
 * the invoice he has been sending. Rendered with white-space: pre-wrap
 * (.doc-info-body), so the tabs and newlines survive onto the document.
 *
 * The app appends its own lines here on conversion ("הומר מהצעת מחיר #...",
 * "הצעה בתוקף עד: ..."), so this builds only the gig lines and lets the app
 * add the rest.
 */
function buildNotes(gigs) {
  return gigs
    .slice()
    .sort((a, b) => a.date.d - b.date.d)
    .map((g) => {
      const dd = String(g.date.d).padStart(2, "0");
      const mm = String(g.date.m).padStart(2, "0");
      const amount = g.amount.toFixed(2);
      const forWhat = g.forWhat ? ` = ${g.forWhat}` : "";
      return `${dd}/${mm}/${g.date.y}\t${g.venue}\t${amount}${forWhat}`;
    })
    .join("\n");
}

function previousPeriod(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based; already "last month" as a 1-based value
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ main ---

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const periodArg = argv[argv.indexOf("--period") + 1];
  const period =
    argv.includes("--period") && /^\d{4}-\d{2}$/.test(periodArg || "")
      ? periodArg
      : previousPeriod();

  const env = readEnv();
  const secret = process.env.AUTOMATION_SECRET || env.AUTOMATION_SECRET;
  const baseUrl =
    process.env.PROPOSAL_API_URL || env.PROPOSAL_API_URL || "https://friendlyinvoice.co.il";

  const wb = newestWorkbook(GIGS_DIR);
  const { gigs: all, skipped, oddFlags, undated } = readGigs(wb.file);
  const inPeriod = all.filter((g) => g.period === period);
  const pending = inPeriod.filter((g) => !g.invoiced);

  console.log(`קובץ: ${wb.name}  (עודכן ${new Date(wb.mtime).toLocaleString("he-IL")})`);
  console.log(`תקופה: ${period}  ·  הופעות בחודש: ${inPeriod.length}  ·  ללא חשבונית: ${pending.length}`);

  // Rows the parser could not use, reported for the period in question. A
  // silently skipped row is an under-bill, which is the failure this whole
  // automation exists to prevent.
  const skippedHere = skipped.filter((r) => periodOf(r.date) === period);
  const oddHere = oddFlags.filter((r) => periodOf(r.date) === period);
  const warnings = [];
  for (const r of skippedHere) {
    warnings.push(`שורה ללא סכום תקין: ${r.date.d}/${r.date.m} ${r.venue} (${r.raw || "ריק"})`);
  }
  for (const r of undated) {
    warnings.push(`שורה עם סכום אך בלי תאריך קריא: ${r.venue} (${r.amount} ₪, תאריך "${r.raw}")`);
  }
  for (const r of oddHere) {
    warnings.push(`ערך לא ברור בעמודת "הוצאתי חשבונית?": ${r.date.d}/${r.date.m} ${r.venue} = "${r.raw}"`);
  }
  for (const w of warnings) console.warn(`⚠ ${w}`);

  // Fail closed. A warning means the sheet holds a row this parser could not
  // read with confidence, so any proposal built from the rest of the month is
  // of unknown completeness. Posting it anyway invites a one-click approval of
  // an under-bill, which is the exact failure this automation must not create.
  if (warnings.length > 0) {
    console.error("נמצאו שורות שלא ניתן לקרוא בביטחון. לא נשלחת הצעה.");
    await pushToGaya(
      `פיניש ${period}: לא הכנתי חשבונית - יש ${warnings.length} שורות בקובץ שצריך לתקן:\n${warnings.join("\n")}`,
    );
    return { posted: false, reason: "parse-warnings", period, warnings };
  }

  if (pending.length === 0) {
    console.log("אין מה להציע. יוצא.");
    return { posted: false, reason: "nothing-pending", period, warnings };
  }

  const billTos = [...new Set(pending.map((g) => g.billTo))];
  if (billTos.length > 1) {
    // Two payers in one month is a real case (פיניש vs another producer) and
    // one invoice cannot cover both. Stop rather than guess.
    console.error(`יותר מלקוח אחד בחודש הזה: ${billTos.join(", ")}. דורש טיפול ידני.`);
    return { posted: false, reason: "multiple-clients", period, billTos };
  }

  const { items, subject } = buildItems(pending, period);
  const notes = buildNotes(pending);
  const total = round2(items.reduce((s, i) => s + i.total, 0));
  const details = pending.map((g) => ({
    label: `${String(g.date.d).padStart(2, "0")}/${String(g.date.m).padStart(2, "0")}`,
    note: g.venue,
    amount: g.amount,
  }));

  console.log(`\nנושא: ${subject}`);
  for (const i of items) {
    console.log(`  ${i.description} · ${i.quantity} × ${i.unitPrice} = ${i.total}`);
  }
  console.log(`  סה"כ: ${total} ₪`);
  console.log("\nהערות שיופיעו על המסמך:");
  console.log(notes.split("\n").map((l) => "  " + l).join("\n"));

  if (dryRun) {
    console.log("\n--dry-run: לא נשלח.");
    return { posted: false, reason: "dry-run", period, total, items, details, subject };
  }
  if (!secret) {
    throw new Error("AUTOMATION_SECRET is missing (.env.local)");
  }

  const res = await fetch(`${baseUrl}/api/proposals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      businessId: BUSINESS_ID,
      source: SOURCE,
      sourceLabel: `${SOURCE_LABEL} (${wb.name})`,
      period,
      documentType: DOCUMENT_TYPE,
      // The client id is Finish's. If the month's payer is someone else the
      // id must NOT ride along, or the document would carry one company's
      // name against another company's client record.
      clientId: billTos[0] === CLIENT_NAME ? CLIENT_ID : "",
      clientName: billTos[0] || CLIENT_NAME,
      subject,
      items,
      notes,
      details,
    }),
  });
  const json = await res.json().catch(() => ({}));

  if (res.status === 409) {
    // The period was already approved or dismissed, yet the sheet still has
    // un-invoiced gigs for it - typically a gig added late. Nobody reads this
    // script's stdout on an unattended monthly run, so this must reach Asaf.
    console.log(`התקופה ${period} כבר טופלה (${json.status}), אבל יש עוד ${pending.length} הופעות לא מחויבות.`);
    await pushToGaya(
      `פיניש ${period}: כבר הופקה חשבונית לחודש הזה, אבל בקובץ יש עוד ${pending.length} הופעות מסומנות "לא" (${total.toLocaleString("he-IL")} ₪). צריך טיפול ידני.`,
    );
    return { posted: false, reason: "already-resolved", period, total, subject, pending: pending.length };
  }
  if (!res.ok || !json.ok) {
    throw new Error(`POST /api/proposals failed: ${res.status} ${JSON.stringify(json)}`);
  }

  console.log(`\n✓ ${json.refreshed ? "ההצעה עודכנה" : "ההצעה נשלחה"} (id ${json.id}).`);

  // Tell Asaf on WhatsApp. This runs unattended on the 1st of the month, so
  // without a push the proposal would sit on a dashboard nobody opened.
  await pushToGaya(
    `חשבונית מוכנה לאישור: ${subject}
${pending.length} הופעות · ${total.toLocaleString("he-IL")} ₪
לאישור בלחיצה: ${baseUrl}/dashboard` +
      (warnings.length ? `\n\n⚠ ${warnings.join("\n⚠ ")}` : ""),
  );

  return { posted: true, refreshed: !!json.refreshed, period, total, subject, count: pending.length };
}

export { main, readGigs, buildItems, buildNotes, parseCellDate, previousPeriod, newestWorkbook, GIGS_DIR };

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then((r) => {
      if (!r.posted) process.exitCode = 0;
    })
    .catch((err) => {
      console.error("שגיאה:", err.message);
      process.exitCode = 1;
    });
}

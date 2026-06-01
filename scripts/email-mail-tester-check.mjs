#!/usr/bin/env node
/* eslint-disable no-console */
// Layer 3 of the email-defense stack: monthly deep deliverability score.
//
// Layers 1 + 2 catch structural HTML regressions and basic delivery
// failures. They do NOT score how a real spam filter would rate the
// sender. mail-tester.com runs an email through a Spamassassin-style
// gauntlet (SPF, DKIM, DMARC alignment, reputation, body heuristics,
// link health) and returns a 0-10 score with a detailed breakdown.
//
// What this script does:
//   1) GETs mail-tester.com homepage, parses out the test address
//      (format: test-XXXXXXXXX@srv1.mail-tester.com)
//   2) Sends a representative invoice email to that address via the
//      same Gmail SMTP transport production uses
//   3) Waits ~90s for mail-tester to process
//   4) GETs the result page and extracts the score from the HTML
//   5) Returns the score + URL so the workflow can WhatsApp-push it
//
// Free tier limit: 3 tests/day, so this runs monthly, not weekly.
// On any failure (network, parse, score < threshold), exits non-zero
// with a JSON summary the workflow forwards to the user.
//
// Env vars required:
//   GMAIL_USER, GMAIL_APP_PASSWORD - Gmail SMTP credentials
// Optional:
//   MAIL_TESTER_MIN_SCORE - integer threshold for pass (default: 8)

import nodemailer from "nodemailer";

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const MIN_SCORE = Number(process.env.MAIL_TESTER_MIN_SCORE || 8);

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("✗ GMAIL_USER / GMAIL_APP_PASSWORD missing");
  process.exit(1);
}

// Step 1 — mint a fresh test address.
// mail-tester.com generates the ID client-side via JS so the homepage
// HTML doesn't carry it. Their backend accepts any test-XXXX address
// against srv1.mail-tester.com and lazily creates the session when
// the result URL is first visited. Generating our own ID gives us
// the same flow without scraping the homepage.
console.log("[1/5] minting fresh test address…");
const testId = Array.from({ length: 12 }, () =>
  "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)],
).join("");
const testAddress = `test-${testId}@srv1.mail-tester.com`;
const resultUrl = `https://www.mail-tester.com/test-${testId}`;
console.log(`✓ test address: ${testAddress}`);
console.log(`  result URL:   ${resultUrl}`);

// Step 2 — send a representative invoice-style email
console.log("[2/5] sending representative invoice email…");
const SAMPLE_VIEW_URL = "https://mysuperfriendlyinvoiceapp.vercel.app/view/sample";
const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>חשבונית מס</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,sans-serif;">
  <div dir="rtl" style="max-width:600px;margin:0 auto;padding:20px;">
    <h1 style="font-size:20px;">חשבונית מס #12345</h1>
    <p style="font-size:14px;color:#44403c;">
      שלום, מצורף מסמך מס על סך ₪1,200 לטיפול.
    </p>
    <p style="font-size:13px;">
      <a href="${SAMPLE_VIEW_URL}">${SAMPLE_VIEW_URL}</a>
    </p>
    <p style="font-size:12px;color:#a8a29e;">
      מסמך זה נשלח אוטומטית.
    </p>
  </div>
</body>
</html>`;
const text = `שלום,

מצורף מסמך מס מספר #12345 על סך ₪1,200.

לצפייה במסמך:
${SAMPLE_VIEW_URL}
`;

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
});
const sendInfo = await transporter.sendMail({
  from: `"Invoice Test" <${GMAIL_USER}>`,
  to: testAddress,
  subject: "חשבונית מס #12345",
  html,
  text,
});
console.log(`✓ sent. messageId=${sendInfo.messageId}`);

// Step 3 — wait for mail-tester to process
console.log("[3/5] waiting 90s for mail-tester to score…");
await new Promise((r) => setTimeout(r, 90_000));

// Step 4 — fetch the result page + parse the score
console.log(`[4/5] fetching ${resultUrl}…`);
const resultRes = await fetch(resultUrl, {
  headers: { "User-Agent": "Mozilla/5.0 (compatible; invoice-app-deliverability-check)" },
});
if (!resultRes.ok) {
  console.error(`✗ result page returned HTTP ${resultRes.status}`);
  process.exit(4);
}
const resultHtml = await resultRes.text();

// Step 5 — parse the score. mail-tester renders it in a few forms,
// most reliably as `Your score: X.X/10` and `<div class="score">X.X/10`.
// Multiple regex paths so a minor markup change doesn't kill us silently.
const scorePatterns = [
  /Your\s*(?:lovely\s+)?total\s*[:.]?\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i,
  /score[^0-9]{0,40}([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i,
  /([0-9]+(?:\.[0-9]+)?)\s*\/\s*10\b/,
];
let score = null;
for (const re of scorePatterns) {
  const m = resultHtml.match(re);
  if (m) {
    score = parseFloat(m[1]);
    if (!Number.isNaN(score)) break;
  }
}

const summary = {
  ok: false,
  testAddress,
  resultUrl,
  score,
  minScore: MIN_SCORE,
  timestamp: new Date().toISOString(),
};

if (score == null || Number.isNaN(score)) {
  console.error("✗ could not parse score from result page");
  console.error("first 500 chars:", resultHtml.slice(0, 500));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(5);
}

summary.ok = score >= MIN_SCORE;
console.log("=".repeat(60));
console.log(`mail-tester score: ${score}/10 (threshold: ${MIN_SCORE})`);
console.log(summary.ok ? "✓ PASS — deliverability healthy" : "✗ FAIL — score below threshold");
console.log("=".repeat(60));
console.log(JSON.stringify(summary, null, 2));

process.exit(summary.ok ? 0 : 1);

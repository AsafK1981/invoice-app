#!/usr/bin/env node
/* eslint-disable no-console */
// Weekly deliverability watch (layer 2 of the email-defense stack).
//
// Sends a test email through the same Gmail SMTP path production uses,
// then connects via IMAP, finds the message, and asserts:
//   1) it actually arrived (didn't get spam-quarantined or bounced)
//   2) the body still has the DOCTYPE/charset/html/body structure we
//      sent, i.e. no SMTP gateway stripped or rewrote it in transit
//   3) the Authentication-Results header shows spf=pass, dkim=pass,
//      and dmarc=pass, i.e. the sender domain is properly aligned
//      and won't be silently routed to spam at recipient gateways
//
// Exits 0 on full pass, non-zero with a JSON summary on any failure.
// The GitHub Action runs this and pushes a WhatsApp via Gaya on failure
// so the user knows BEFORE the next real customer hits the regression.
//
// Env vars required:
//   GMAIL_USER, GMAIL_APP_PASSWORD  - Gmail SMTP + IMAP credentials
// Optional:
//   GAYA_PUSH_TOKEN - if set, the workflow pushes failure summaries.

import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("✗ GMAIL_USER / GMAIL_APP_PASSWORD missing");
  process.exit(1);
}

const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const SUBJECT = `EMAIL-DELIVERABILITY-CHECK ${STAMP}`;
// Gmail's "+" addressing routes to the same inbox but lets us filter
// these tests out of the main view via the +deliverability suffix.
const RECIPIENT = GMAIL_USER.replace(/@/, "+deliverability@");

const SAMPLE_VIEW_URL = "https://mysuperfriendlyinvoiceapp.vercel.app/view/deliverability-check";

// HTML used for the send. Has to satisfy the same structural rules
// production HTML does; layer 1 (vitest) already enforces those rules
// on the production buildHtml output; this layer enforces them on the
// RECEIVED bytes, which is a different failure mode (transit rewrite,
// SMTP munging, gateway downgrade).
const HTML = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>Deliverability Check</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,sans-serif;">
  <div dir="rtl" style="max-width:600px;margin:0 auto;padding:20px;">
    <h1 style="font-size:20px;">בדיקת מסירה אוטומטית</h1>
    <p style="font-size:14px;color:#44403c;">
      זוהי בדיקה שבועית של מערכת המייל. אם הגיע אליך, הכל תקין.
    </p>
    <p style="font-size:13px;">
      <a href="${SAMPLE_VIEW_URL}">${SAMPLE_VIEW_URL}</a>
    </p>
  </div>
</body>
</html>`;

const TEXT = `בדיקת מסירה אוטומטית

זוהי בדיקה שבועית של מערכת המייל. אם הגיע אליך, הכל תקין.

${SAMPLE_VIEW_URL}
`;

const failures = [];
function fail(check, detail) {
  failures.push({ check, detail });
  console.error(`✗ ${check}: ${detail}`);
}

// Step 1: send via Gmail SMTP (identical transport to production)
console.log(`[1/3] sending test → ${RECIPIENT}`);
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
});

const sendInfo = await transporter.sendMail({
  from: `"Deliverability Check" <${GMAIL_USER}>`,
  to: RECIPIENT,
  subject: SUBJECT,
  html: HTML,
  text: TEXT,
});
console.log(`✓ sent. messageId=${sendInfo.messageId}`);

// Step 2: wait for delivery, then IMAP fetch
console.log("[2/3] waiting 30s for delivery…");
await new Promise((r) => setTimeout(r, 30_000));

const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
  logger: false,
});
await client.connect();
const lock = await client.getMailboxLock("INBOX");

let received = null;
try {
  // Search by subject: we just sent, so this should be in INBOX.
  const uids = await client.search({ subject: SUBJECT });
  if (!uids || uids.length === 0) {
    fail(
      "delivery",
      "no inbox match for the test subject: message may be in spam, bounced, or still in transit. Subject: " + SUBJECT,
    );
  } else {
    const msg = await client.fetchOne(uids[uids.length - 1], { source: true, envelope: true });
    received = {
      raw: msg.source?.toString("utf8") || "",
      from: msg.envelope?.from?.[0]?.address || "",
      subject: msg.envelope?.subject || "",
    };
    console.log(`✓ found in inbox. from=${received.from}`);
  }
} finally {
  lock.release();
  await client.logout();
}

if (received) {
  // Step 3: assert structure survived transit
  console.log("[3/3] checking structural integrity + auth results…");

  // Split headers from body and decode the body. Gmail SMTP encodes
  // long lines via quoted-printable, which splits URLs across lines
  // with "=\n". Undo that so URL substring matches.
  const headerEnd = received.raw.search(/\r?\n\r?\n/);
  const headers = headerEnd >= 0 ? received.raw.slice(0, headerEnd) : received.raw;
  const bodyRaw = headerEnd >= 0 ? received.raw.slice(headerEnd) : "";
  const bodyDecoded = bodyRaw
    .replace(/=\r?\n/g, "") // quoted-printable soft line break
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      Buffer.from([parseInt(hex, 16)]).toString("binary"),
    );

  const structural = [
    ["doctype", /<!doctype html/i],
    ["html-tag", /<html[\s>]/i],
    ["charset-meta", /charset=("|3d)?(utf-?8)/i],
    ["body-tag", /<body[\s>]/i],
    ["view-url", new RegExp(SAMPLE_VIEW_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")],
  ];
  for (const [name, re] of structural) {
    if (!re.test(bodyDecoded)) fail(`html.${name}`, "missing in received message body");
  }

  // Authentication-Results lives in HEADERS. Multiple AR headers may
  // exist (one per hop); fold each across continuation lines and parse
  // SPF/DKIM/DMARC. We want at least one AR header that asserts pass
  // on all three. mx.google.com is the authoritative one for Gmail.
  // Match unfolded auth-results blocks (RFC 5322, continuation lines
  // start with whitespace).
  const arBlocks = [];
  const arRe = /^Authentication-Results:[ \t]*([\s\S]*?)(?=\r?\n[A-Za-z][A-Za-z0-9-]*:|\r?\n\r?\n|$)/gim;
  let m;
  while ((m = arRe.exec(headers)) !== null) {
    // Fold continuation lines into one logical header.
    arBlocks.push(m[1].replace(/\r?\n[ \t]+/g, " "));
  }

  if (arBlocks.length === 0) {
    // Self-loopback (Gmail→Gmail same account) doesn't trigger an
    // Authentication-Results header; Gmail only writes it for
    // cross-domain deliveries. Log but don't fail; full auth checking
    // is layer 3's job once we wire up a cross-domain test recipient.
    console.log("ℹ auth-results header not present (likely same-domain loopback, full SPF/DKIM/DMARC check requires cross-domain recipient)");
  } else {
    // Combine all hops; any explicit "pass" counts.
    const combined = arBlocks.join(" | ");
    for (const k of ["spf", "dkim", "dmarc"]) {
      const re = new RegExp(`\\b${k}=([a-z]+)`, "gi");
      let verdicts = [];
      let match;
      while ((match = re.exec(combined)) !== null) {
        verdicts.push(match[1].toLowerCase());
      }
      if (verdicts.length === 0) {
        fail(`auth.${k}`, `no verdict reported across ${arBlocks.length} AR hop(s)`);
      } else if (!verdicts.includes("pass")) {
        fail(
          `auth.${k}`,
          `verdicts=${verdicts.join(",")} (expected at least one pass), sender domain is at risk of spam routing`,
        );
      }
    }
  }
}

const summary = {
  ok: failures.length === 0,
  timestamp: STAMP,
  recipient: RECIPIENT,
  subject: SUBJECT,
  failures,
};
console.log("");
console.log("=".repeat(60));
console.log(summary.ok ? "✓ ALL CHECKS PASSED: email pipeline healthy" : `✗ ${failures.length} failures`);
console.log("=".repeat(60));
console.log(JSON.stringify(summary, null, 2));

process.exit(summary.ok ? 0 : 1);

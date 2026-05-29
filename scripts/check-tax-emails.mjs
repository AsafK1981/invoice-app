#!/usr/bin/env node
// Polls Gmail for new emails from taxes.gov.il (Israeli Tax Authority).
// For each new one, pushes a WhatsApp via Gaya. Deduplication is
// SERVER-SIDE: we POST to Gaya's /watch-claim with the Message-Id and only
// send /push when claim.first === true. This replaces the git-stored
// seen-list which raced between cron ticks and produced duplicate
// WhatsApps (2026-05-28 incident).
//
// Env vars required:
//   GMAIL_USER, GMAIL_APP_PASSWORD  - Gmail IMAP credentials
//   GAYA_PUSH_TOKEN                 - Bearer token (same one /push uses)
//
// Runs inside GitHub Actions: tax-email-watch.yml

import { ImapFlow } from "imapflow";

const GAYA_BASE = "https://136.111.197.22.nip.io";
const SOURCE = "tax-email-watch";
const LOOKBACK_DAYS = 2;

async function claimFirstTime(id) {
  const token = process.env.GAYA_PUSH_TOKEN;
  if (!token) {
    console.error("GAYA_PUSH_TOKEN missing; failing CLOSED (no push) to avoid spam");
    return false;
  }
  try {
    const res = await fetch(`${GAYA_BASE}/watch-claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: SOURCE, id }),
    });
    if (!res.ok) {
      console.error(`watch-claim returned ${res.status}; failing CLOSED to avoid spam`);
      return false;
    }
    const data = await res.json();
    return data.first === true;
  } catch (err) {
    console.error(`watch-claim error: ${err.message}; failing CLOSED to avoid spam`);
    return false;
  }
}

async function pushWhatsApp(text) {
  const token = process.env.GAYA_PUSH_TOKEN;
  if (!token) {
    console.error("GAYA_PUSH_TOKEN missing");
    return false;
  }
  const res = await fetch(`${GAYA_BASE}/push`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, source: SOURCE }),
  });
  console.log(`push status: ${res.status}`);
  return res.ok;
}

function looksFromTaxAuthority(addressList) {
  if (!addressList) return false;
  for (const a of addressList) {
    const addr = (a.address || "").toLowerCase();
    if (addr.endsWith("@taxes.gov.il")) return true;
  }
  return false;
}

async function main() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.error("GMAIL_USER or GMAIL_APP_PASSWORD missing");
    process.exit(1);
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  console.log(`connected to imap.gmail.com as ${user}`);

  const lock = await client.getMailboxLock("INBOX");
  let sentCount = 0;
  let skippedDup = 0;
  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const uids = await client.search({ since });
    console.log(`search since ${since.toISOString()}: ${uids?.length || 0} messages`);
    if (!uids || uids.length === 0) return;

    for await (const msg of client.fetch(uids, { envelope: true, internalDate: true })) {
      const env = msg.envelope;
      if (!env) continue;
      const isTax = looksFromTaxAuthority(env.from) || looksFromTaxAuthority(env.replyTo);
      if (!isTax) continue;

      const id = env.messageId || `${env.from?.[0]?.address}|${env.date}|${env.subject}`;

      // Server-side atomic claim — first run wins, every subsequent call
      // for the same id returns first=false. No race possible.
      const isFirst = await claimFirstTime(id);
      if (!isFirst) {
        skippedDup++;
        continue;
      }

      const fromName = env.from?.[0]?.name || env.from?.[0]?.address || "Tax Authority";
      const fromAddr = env.from?.[0]?.address || "";
      const subject = env.subject || "(ללא נושא)";
      const dateStr = env.date ? new Date(env.date).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "";

      const text =
        `📩 הגיע מייל מרשות המסים\n` +
        `מאת: ${fromName} <${fromAddr}>\n` +
        `נושא: ${subject}\n` +
        `זמן: ${dateStr}\n` +
        `\nפתח Gmail כדי לקרוא ולענות.`;

      console.log(`new tax email: ${subject} from ${fromAddr}`);
      const ok = await pushWhatsApp(text);
      if (ok) sentCount++;
      else console.error("push failed for", id);
    }
  } finally {
    lock.release();
    await client.logout();
  }

  console.log(`done. sent=${sentCount}, dedup-skipped=${skippedDup}`);
}

main().catch((err) => {
  console.error("fatal:", err.message);
  process.exit(1);
});

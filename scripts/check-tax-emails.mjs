#!/usr/bin/env node
// Polls Gmail for new emails from taxes.gov.il (Israeli Tax Authority).
// For each new one, pushes a WhatsApp via Gaya. State (seen Message-Ids)
// persists in .github/tax-email-state.json so dupes are not re-fired.
//
// Env vars required:
//   GMAIL_USER, GMAIL_APP_PASSWORD  - Gmail IMAP credentials
//   GAYA_PUSH_TOKEN                 - Bearer token for the /push endpoint
//
// Runs inside GitHub Actions: tax-email-watch.yml

import { ImapFlow } from "imapflow";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STATE_PATH = ".github/tax-email-state.json";
const TAX_SENDERS = /taxes\.gov\.il>?$/i;
const LOOKBACK_DAYS = 2;

function loadState() {
  if (!existsSync(STATE_PATH)) return { seen: [] };
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { seen: [] };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const trimmed = { ...state, seen: state.seen.slice(-200) };
  writeFileSync(STATE_PATH, JSON.stringify(trimmed, null, 2) + "\n");
}

async function pushWhatsApp(text) {
  const token = process.env.GAYA_PUSH_TOKEN;
  if (!token) {
    console.error("GAYA_PUSH_TOKEN missing");
    return false;
  }
  const res = await fetch("https://136.111.197.22.nip.io/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, source: "tax-email-watch" }),
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

  const state = loadState();
  const seen = new Set(state.seen);

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
  let newCount = 0;
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
      if (seen.has(id)) continue;

      seen.add(id);
      newCount++;

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
      if (!ok) console.error("push failed for", id);
    }
  } finally {
    lock.release();
    await client.logout();
  }

  state.seen = Array.from(seen);
  state.lastRun = new Date().toISOString();
  saveState(state);
  console.log(`done. new=${newCount}, total tracked=${state.seen.length}`);
}

main().catch((err) => {
  console.error("fatal:", err.message);
  process.exit(1);
});

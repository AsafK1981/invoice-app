#!/usr/bin/env node
/* eslint-disable no-console */
// One-off: read the recent thread with רשות המסים (*@taxes.gov.il) so
// Claude can draft a follow-up. Read-only: never marks as seen.
// Handles windows-1255 (Outlook Hebrew encoding) properly so replies
// don't come out as gibberish.

import { ImapFlow } from "imapflow";
import { readFileSync } from "node:fs";
import { decodeAllText } from "./lib/mime-decode.mjs";

const env = (() => {
  try {
    return readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    console.error("ENV_FILE_GUARD: .env.local not found");
    process.exit(1);
  }
})()
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [k, ...rest] = line.split("=");
    if (k) acc[k.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const GMAIL_USER = env.GMAIL_USER;
const GMAIL_APP_PASSWORD = env.GMAIL_APP_PASSWORD;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("GMAIL_USER / GMAIL_APP_PASSWORD missing in .env.local");
  process.exit(1);
}

const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
  logger: false,
  // Don't hang forever if Gmail's IMAP endpoint stalls mid-handshake.
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 30000,
});

// Body decoding (QP/base64 + windows-1255 etc.) lives in ./lib/mime-decode.mjs.

async function searchFolder(folder, params) {
  const lock = await client.getMailboxLock(folder);
  const out = [];
  try {
    const uids = await client.search(params);
    if (!uids || uids.length === 0) return out;
    const lastFew = uids.slice(-15);
    for (const uid of lastFew) {
      const msg = await client.fetchOne(uid, { source: true, envelope: true });
      const raw = msg.source?.toString("binary") || "";
      out.push({
        folder,
        date: msg.envelope?.date?.toISOString?.() || "?",
        from: msg.envelope?.from?.[0]?.address || "?",
        to: (msg.envelope?.to || []).map((a) => a.address).join(", "),
        subject: msg.envelope?.subject || "(no subject)",
        body: decodeAllText(raw).slice(0, 6000),
      });
    }
  } finally {
    lock.release();
  }
  return out;
}

let inboxMatches = [];
let sentMatches = [];
try {
  // connect() inside the try so a network/auth failure mid-handshake
  // still triggers the finally; imapflow can leave a half-open socket
  // otherwise, and Gmail rate-limits the account after a few of those.
  await client.connect();
  inboxMatches = await searchFolder("INBOX", { from: "taxes.gov.il" });
  sentMatches = await searchFolder("[Gmail]/Sent Mail", { to: "taxes.gov.il" });
} finally {
  try {
    await client.logout();
  } catch {
    // Already disconnected or never connected; nothing useful to do.
  }
}

const all = [...inboxMatches, ...sentMatches].sort((a, b) =>
  a.date.localeCompare(b.date),
);

// Print only the last 8: focus on most recent thread state.
const recent = all.slice(-8);

console.log(`Showing last ${recent.length} of ${all.length} messages.\n${"=".repeat(60)}`);
for (const m of recent) {
  console.log(`\n[${m.date}] ${m.folder}`);
  console.log(`From: ${m.from}`);
  console.log(`To:   ${m.to}`);
  console.log(`Subj: ${m.subject}`);
  console.log(`Body:\n${m.body}`);
  console.log("-".repeat(60));
}

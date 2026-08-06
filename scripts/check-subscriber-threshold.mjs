#!/usr/bin/env node
/**
 * Fires once when real paying subscribers first reach the threshold at which
 * reopening the Tranzila migration becomes worth doing.
 *
 * Context (2026-08-06): Tranzila is PARKED, not rejected - Asaf prefers them
 * over Polar and every other processor tried, but at zero paying subscribers
 * their ~₪164/mo fixed cost is pure loss while Polar costs ₪0 fixed. Break-even
 * is 74-85 paying monthly subscribers, so the process must START earlier than
 * that: signature-to-live is realistically 4-8 weeks (file opening, terminal
 * provisioning, building the token-capture callback and the cron's tranzila
 * branch, sandbox testing). Starting at 50 lands us live around break-even
 * instead of beginning the ramp only after crossing it.
 *
 * This exists because a decision that depends on someone remembering to check a
 * number in six months is a decision that will be missed.
 *
 * Counts only REAL payers: beta grants (plan_beta_grant) are free and must not
 * count toward a threshold about processing fees.
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const MARKER = new URL(".subscriber-threshold-announced", ROOT);
const THRESHOLD = 50;

const env = readFileSync(new URL(".env.local", ROOT), "utf8")
  .split("\n")
  .reduce((a, line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) a[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    return a;
  }, {});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Exit codes are set via process.exitCode and the script is allowed to unwind
 * naturally. Calling process.exit() here would abort while undici still holds
 * keep-alive sockets, which on Windows crashes with a libuv assertion and
 * reports 127 - a scheduled task would read that as a failure every run.
 */

/**
 * Paying = on a non-free tier, active, and NOT a free beta grant. Walks the
 * admin user pages rather than assuming one page covers everyone.
 */
async function countRealPayers() {
  let page = 1;
  let payers = 0;
  let total = 0;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    if (!res.ok) throw new Error(`admin/users ${res.status}: ${await res.text()}`);
    const { users = [] } = await res.json();
    if (users.length === 0) break;
    for (const u of users) {
      total++;
      const m = { ...(u.user_metadata || {}), ...(u.app_metadata || {}) };
      if (m.plan_tier && m.plan_tier !== "free" && m.plan_active && !m.plan_beta_grant) payers++;
    }
    if (users.length < 1000) break;
    page++;
  }
  return { payers, total };
}

async function main() {
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exitCode = 1;
  return;
}

const { payers, total } = await countRealPayers();
const stamp = new Date().toISOString();

if (payers < THRESHOLD) {
  console.log(`[${stamp}] ${payers}/${THRESHOLD} real paying subscribers (${total} users total) - staying quiet.`);
  return;
}

if (existsSync(MARKER)) {
  console.log(`[${stamp}] ${payers} payers, threshold already announced - staying quiet.`);
  return;
}

const text = [
  `📈 ${payers} מנויים משלמים אמיתיים (מתוך ${total} משתמשים) - עברת את הסף של ${THRESHOLD}.`,
  ``,
  `זה הרגע לפתוח מחדש את Tranzila. הם הספק המועדף, וההקפאה הייתה רק תזמון.`,
  `נקודת האיזון מול Polar היא 74-85 מנויים, והתהליך לוקח 4-8 שבועות - מתחילים עכשיו כדי להיות באוויר בערך כשזה מתחיל להשתלם.`,
  ``,
  `לפני חתימה, לקבל בכתב בתוך השרשור: (1) האם החתימה עצמה מתחילה את החיוב, (2) האם אפשר לחייב טוקן שמור בלי מודול My Billing.`,
].join("\n");

if (!env.GAYA_PUSH_URL || !env.GAYA_PUSH_TOKEN) {
  console.error("GAYA_PUSH_URL / GAYA_PUSH_TOKEN missing in .env.local - cannot push");
  console.log(text);
  process.exitCode = 1;
  return;
}

try {
  const res = await fetch(env.GAYA_PUSH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GAYA_PUSH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, source: "invoice-app-billing" }),
  });
  console.log(`[gaya push] ${res.status}`);
  // Mark only after the push actually left, so a failed push retries next week.
  if (res.ok) writeFileSync(MARKER, `${stamp} payers=${payers}\n`);
} catch (e) {
  console.error(`[gaya push failed] ${e.message}`);
  process.exitCode = 1;
}
}

await main();

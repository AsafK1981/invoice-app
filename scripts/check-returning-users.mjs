#!/usr/bin/env node
/**
 * Fires when a customer first becomes a RETURNING user - the earliest honest
 * signal that someone is worth billing.
 *
 * Context (2026-09-23): Asaf asked "is anyone active for over a month, whom I
 * should start charging?". The answer was no, and the interesting part was WHY:
 * every account older than a month had never issued a single document, and
 * every active account had signed up in the previous three weeks. The two
 * groups did not overlap at all. Counting "users" or "documents" hides that;
 * counting people who came BACK does not.
 *
 * Qualifying = created documents IN THE APP in at least two different calendar
 * months, and the account is at least 30 days old. Both halves matter:
 *  - Two months of activity is the difference between trying the app once and
 *    actually running a business on it. One burst of 300 imported documents on
 *    signup day is a migration, not a habit, which is why imported rows
 *    (import_batch_id set) are excluded - the same rule the admin turnover card
 *    learned on 2026-09-14.
 *  - 30 days because the product promises a free first month; nobody can be
 *    billed before that anyway.
 *
 * Zero-noise, same contract as check-subscriber-threshold.mjs: one WhatsApp via
 * Gaya the first time a given person qualifies, then silence about that person
 * forever. A quiet week pushes nothing.
 *
 * Reads only metadata - counts, dates, and the signup email that /admin already
 * shows. Never reads document content, client names or amounts (operator
 * privacy rule).
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const STATE = new URL(".returning-users-announced.json", ROOT);

/** Months of in-app activity that make someone a returning user. */
const MONTHS_REQUIRED = 2;
/** Account must be at least this old - the free first month. */
const MIN_ACCOUNT_AGE_DAYS = 30;

/**
 * Businesses that are ours, not customers'. Mirrors
 * src/lib/internal-accounts.ts INTERNAL_BUSINESS_ID_PREFIXES - keep both in
 * sync, and scripts/count-data.mjs with them.
 */
const INTERNAL_PREFIXES = new Set([
  "dc3b5b61", // the founder's own business
  "eda11499", // father's עוסק מורשה, tax-authority testing
  "957d0e04", // seeded demo account
  "23673f84", // QA/audit account
  "acf71faa", // the founder's first throwaway test account
  "3085885f", // Lynkeus automated QA bot
]);

// .env.local starts with a UTF-8 BOM and uses CRLF. Without stripping both, every
// key reads as undefined (this silently broke invoice-app-subscriber-threshold
// until 2026-09-15).
const env = readFileSync(new URL(".env.local", ROOT), "utf8")
  .replace(/^﻿/, "")
  .split(/\r?\n/)
  .reduce((a, line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) a[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    return a;
  }, {});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

/** Pages a PostgREST table so a growing dataset never silently truncates. */
async function fetchAll(path, select, extra = "") {
  const out = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?select=${select}${extra}`, {
      headers: { ...headers, Range: `${from}-${from + pageSize - 1}` },
    });
    if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

async function fetchUsers() {
  const byId = new Map();
  for (let page = 1; ; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      headers,
    });
    if (!res.ok) throw new Error(`admin/users ${res.status}: ${await res.text()}`);
    const { users = [] } = await res.json();
    for (const u of users) byId.set(u.id, u);
    if (users.length < 1000) break;
  }
  return byId;
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
    process.exitCode = 1;
    return;
  }

  // A bad minute on a weekly check is not worth a WhatsApp: fail quietly with a
  // non-zero exit code and let the next run take the sample.
  let businesses, documents, users;
  try {
    [businesses, documents, users] = await Promise.all([
      fetchAll("businesses", "id,user_id"),
      fetchAll("documents", "business_id,created_at,import_batch_id"),
      fetchUsers(),
    ]);
  } catch (e) {
    console.error(`[returning-users check failed] ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const ownerOf = new Map();
  for (const b of businesses) {
    if (INTERNAL_PREFIXES.has(String(b.id).slice(0, 8))) continue;
    ownerOf.set(b.id, b.user_id);
  }

  /** user_id -> Set of "YYYY-MM" in which they created a document IN the app. */
  const monthsByUser = new Map();
  for (const d of documents) {
    if (d.import_batch_id) continue; // migrated history, not usage
    const userId = ownerOf.get(d.business_id);
    if (!userId) continue;
    const month = String(d.created_at).slice(0, 7);
    if (!monthsByUser.has(userId)) monthsByUser.set(userId, new Set());
    monthsByUser.get(userId).add(month);
  }

  const qualifying = [];
  for (const [userId, months] of monthsByUser) {
    if (months.size < MONTHS_REQUIRED) continue;
    const user = users.get(userId);
    if (!user) continue;
    if (daysSince(user.created_at) < MIN_ACCOUNT_AGE_DAYS) continue;
    qualifying.push({
      userId,
      email: user.email || "(no email)",
      months: [...months].sort(),
      ageDays: daysSince(user.created_at),
    });
  }

  const announced = new Set(
    existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")).announced || [] : [],
  );
  const fresh = qualifying.filter((q) => !announced.has(q.userId));
  const stamp = new Date().toISOString();

  if (fresh.length === 0) {
    console.log(
      `[${stamp}] ${qualifying.length} returning user(s), none new - staying quiet.`,
    );
    return;
  }

  const lines = [
    fresh.length === 1
      ? `🎯 יש לך משתמש חוזר ראשון: ${fresh[0].email}`
      : `🎯 ${fresh.length} משתמשים חוזרים חדשים:`,
    ``,
    ...fresh.map(
      (q) =>
        `${q.email} - הפיק מסמכים ב-${q.months.length} חודשים שונים (${q.months.join(", ")}), בחשבון כבר ${q.ageDays} יום.`,
    ),
    ``,
    `זה הסימן שחיכינו לו: מישהו שחזר להשתמש בחודש נוסף, לא רק ניסה פעם אחת.`,
    `שווה לשקול להתחיל לגבות ממנו, ולשאול אותו מה היה חסר לו.`,
  ];
  const text = lines.join("\n");

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
      body: JSON.stringify({ text, source: "invoice-app-returning-users" }),
    });
    console.log(`[gaya push] ${res.status} (${fresh.length} new)`);
    // Mark only after the push actually left, so a failed push retries next week.
    if (res.ok) {
      writeFileSync(
        STATE,
        JSON.stringify(
          { announced: [...announced, ...fresh.map((q) => q.userId)], updated: stamp },
          null,
          2,
        ),
      );
    }
  } catch (e) {
    console.error(`[gaya push failed] ${e.message}`);
    process.exitCode = 1;
  }
}

await main();

#!/usr/bin/env node
/* eslint-disable no-console */
// Yearly check: does src/lib/tax-thresholds.ts have an entry for the
// CURRENT calendar year? Run by .github/workflows/exempt-ceiling-check.yml
// on Jan 5 each year, plus manual workflow_dispatch.
//
// Why this exists: רשות המסים updates the עוסק פטור ceiling roughly
// annually (סעיף 31 לחוק מע"מ). The dashboard, business-type picker,
// and yearly journal all read from EXEMPT_CEILING_BY_YEAR. If the table
// is missing the current year, the FALLBACK kicks in — which goes stale.
//
// On detection: pushes a WhatsApp via the Gaya endpoint asking Asaf to
// verify the official value and update tax-thresholds.ts. Doesn't try
// to scrape gov.il — runners are geo-blocked and the page changes
// often. Human-in-the-loop is the reliable path.

import { readFileSync } from "node:fs";

const path = new URL("../src/lib/tax-thresholds.ts", import.meta.url);
const source = readFileSync(path, "utf8");

const currentYear = new Date().getUTCFullYear();

// Grep the source for "currentYear:" inside EXEMPT_CEILING_BY_YEAR.
// Tolerates whitespace, comments, and the underscore-thousands form
// the file uses (120_000).
const re = new RegExp(`\\b${currentYear}\\s*:\\s*([0-9_]+)`);
const m = source.match(re);

const TOKEN = process.env.GAYA_PUSH_TOKEN;
const PUSH_URL = "https://136.111.197.22.nip.io/push";

if (m) {
  const value = m[1].replace(/_/g, "");
  console.log(`✓ ${currentYear} ceiling already set: ₪${Number(value).toLocaleString()}`);
  process.exit(0);
}

console.log(`✗ no ceiling entry for ${currentYear} — will alert`);

if (!TOKEN) {
  console.error("GAYA_PUSH_TOKEN not set — can't push reminder");
  process.exit(1);
}

const text = `🔔 תקרת עוסק פטור — צריך לעדכן

חסר ערך עבור שנת ${currentYear} ב-src/lib/tax-thresholds.ts (האפליקציה משתמשת ב-FALLBACK).

לבדוק:
1) gov.il / רשות המסים → "תקרת מחזור לעוסק פטור ${currentYear}"
2) סעיף 31 לחוק מע"מ — אם פורסם תיקון

לעדכן:
node scripts/update-ceiling.mjs ${currentYear} <amount>

(זה ידחוף קומיט אוטומטי לרפו.)`;

try {
  const res = await fetch(PUSH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, source: "exempt-ceiling-check" }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`push failed: HTTP ${res.status} — ${body}`);
    process.exit(1);
  }
  console.log("✓ reminder pushed via Gaya");
} catch (err) {
  console.error("push error:", err);
  process.exit(1);
}

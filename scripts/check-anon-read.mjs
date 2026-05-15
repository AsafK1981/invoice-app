// Reproduces the AEGIS pentest exploit (F-001, CVSS 9.1) — anon-key read of
// every protected table. MUST return 0 rows on every table. If any returns
// data, the RLS bypass has regressed and the push must be aborted.
//
// Used by the pre-push git hook (.githooks/pre-push).

import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [key, ...rest] = line.split("=");
    if (key) acc[key.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL_BASE || !KEY) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env.local");
  process.exit(1);
}

const TABLES = [
  "businesses",
  "clients",
  "products",
  "documents",
  "document_items",
  "expenses",
  // Added 2026-05-11 after the security audit — any new public-schema
  // table goes here so a forgotten `ENABLE ROW LEVEL SECURITY` is caught
  // before reaching prod.
  "audit_log",
  "document_attachments",
  "document_counters",
  "beta_invites",
  "beta_invite_redemptions",
  "tax_authority_credentials",
  "tax_authority_oauth_states",
];
const leaks = [];

for (const table of TABLES) {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}?select=*&limit=5`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const data = await r.json().catch(() => null);
  const rows = Array.isArray(data) ? data.length : null;
  if (rows !== null && rows > 0) {
    leaks.push({ table, rows });
  }
}

if (leaks.length > 0) {
  console.error("");
  console.error("🚨 SECURITY REGRESSION — anon-key reads returned data:");
  for (const { table, rows } of leaks) {
    console.error(`   ${table}: ${rows} rows`);
  }
  console.error("");
  console.error("This means the AEGIS RLS bypass (CVSS 9.1) has come back.");
  console.error("Do NOT push. Investigate which RLS policy regressed.");
  console.error("To bypass this check anyway: git push --no-verify");
  process.exit(1);
}

console.log(`✓ anon-read locked down (all ${TABLES.length} tables returned 0 rows)`);

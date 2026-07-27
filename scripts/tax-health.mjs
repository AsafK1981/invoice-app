#!/usr/bin/env node
/* eslint-disable no-console */
// On-demand health check for the חשבונית ישראל integration.
// Mirrors /api/cron/tax-health but runnable locally against the live DB.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l && !l.startsWith("#"))
  .reduce((a, l) => { const [k, ...r] = l.split("="); if (k) a[k.trim()] = r.join("=").trim(); return a; }, {});

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase URL / service key missing in .env.local"); process.exit(1); }

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await sb
  .from("tax_authority_credentials")
  .select("business_id, vat_number, environment, connected_at, last_used_at, last_error");
if (error) { console.error("Query failed:", error.message); process.exit(1); }

const rows = data || [];
const failures = rows.filter((c) => c.last_error);
console.log(`Connected businesses: ${rows.length}`);
console.log(`Failures (last_error set): ${failures.length}`);
for (const f of failures) {
  console.log(`  ✗ business ${f.business_id} (vat ${f.vat_number}): "${f.last_error}" (last used ${f.last_used_at})`);
}
for (const r of rows.filter((c) => !c.last_error)) {
  console.log(`  ✓ business ${r.business_id} (vat ${r.vat_number}): ok, connected ${r.connected_at}, last used ${r.last_used_at || "never"}`);
}
console.log(failures.length === 0 ? "\nAll healthy." : `\n⚠ ${failures.length} failing: investigate (software number? token expiry?).`);

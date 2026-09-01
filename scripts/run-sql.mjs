#!/usr/bin/env node
/**
 * Free-form SQL against production through the Supabase Management API.
 *
 * This is the widest door in the repo: it runs whatever it is handed, as the
 * database owner, across every tenant. Since 2026-08-31 it is gated the same
 * way scripts/admin.mjs is - a stated --reason - and every run is recorded in
 * admin_access_log (channel 'sql') together with the SQL text itself.
 *
 * Usage:
 *   node scripts/run-sql.mjs --reason "תמיכה: <תיאור>" "<SQL>"
 *
 * The SQL text IS stored in the log, unlike every other detail payload in this
 * feature. That is deliberate: the query is the operator's action, and a log
 * saying "ran some SQL" would answer nothing. Do not paste customer content
 * into a query you would not want in the journal.
 *
 * The logging is best-effort on purpose. This script is what applies the
 * migration that creates admin_access_log, so it has to keep working before the
 * table exists; a failed log write warns and the SQL still runs.
 */
import { resolveAdminReason } from "./lib/admin-reason.mjs";
import { loadEnv, createServiceClient, logScriptAccess } from "./lib/admin-core.mjs";

const env = loadEnv();

const gate = resolveAdminReason(process.argv.slice(2), process.env);
if (!gate.ok) {
  console.error(gate.message);
  console.error('Usage: node scripts/run-sql.mjs --reason "<סיבה>" \'<SQL>\'');
  process.exit(1);
}

const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const REF = env.SUPABASE_PROJECT_REF;
const sql = gate.rest.join(" ");
if (!sql) {
  console.error('Usage: node scripts/run-sql.mjs --reason "<סיבה>" \'<SQL>\'');
  process.exit(1);
}

// Log before running, not after: an operator query that crashes the API call
// (or the terminal) is exactly the one worth having a record of.
await logScriptAccess(createServiceClient(env), {
  channel: "sql",
  action: "run-sql.mjs",
  reason: gate.reason,
  argv: [],
  detail: { sql },
});

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await r.text();
if (!r.ok) {
  console.error("HTTP", r.status, text);
  process.exit(1);
}
console.log(text);

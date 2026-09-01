#!/usr/bin/env node
// Applies a whole .sql FILE via the Supabase Management API.
//
// scripts/run-sql.mjs takes SQL as argv, which mangles anything containing
// quotes, $$ bodies, or newlines - i.e. every migration that defines a
// function. This reads the file verbatim and sends it as one statement batch,
// so a migration either applies whole or not at all.
//
// Gated like scripts/run-sql.mjs since 2026-08-31: a stated --reason is
// required and every run is recorded in admin_access_log (channel 'sql') with
// the file path. Logging is best-effort - this script is what applies the
// migration that CREATES admin_access_log, so it must work before the table
// exists; a failed log write warns and the file still runs.
//
// Usage: node scripts/run-sql-file.mjs --reason "<סיבה>" scripts/migrations/<file>.sql
import { readFileSync } from "node:fs";
import { resolveAdminReason } from "./lib/admin-reason.mjs";
import { loadEnv, createServiceClient, logScriptAccess } from "./lib/admin-core.mjs";

const env = loadEnv();

const gate = resolveAdminReason(process.argv.slice(2), process.env);
if (!gate.ok) {
  console.error(gate.message);
  console.error('Usage: node scripts/run-sql-file.mjs --reason "<סיבה>" <path-to.sql>');
  process.exit(1);
}

const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const REF = env.SUPABASE_PROJECT_REF;
const path = gate.rest[0];
if (!path) {
  console.error('Usage: node scripts/run-sql-file.mjs --reason "<סיבה>" <path-to.sql>');
  process.exit(1);
}

const sql = readFileSync(path, "utf8");

// Log before running, same as run-sql.mjs: the crashing migration is exactly
// the run worth having a record of. The file path identifies the action; the
// file itself lives in git, so its contents are not duplicated into the log.
await logScriptAccess(createServiceClient(env), {
  channel: "sql",
  action: "run-sql-file.mjs",
  reason: gate.reason,
  argv: [],
  detail: { file: path },
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

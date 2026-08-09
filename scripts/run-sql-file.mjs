#!/usr/bin/env node
// Applies a whole .sql FILE via the Supabase Management API.
//
// scripts/run-sql.mjs takes SQL as argv, which mangles anything containing
// quotes, $$ bodies, or newlines — i.e. every migration that defines a
// function. This reads the file verbatim and sends it as one statement batch,
// so a migration either applies whole or not at all.
//
// Usage: node scripts/run-sql-file.mjs scripts/migrations/<file>.sql
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [k, ...rest] = line.split("=");
    if (k) acc[k.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const REF = env.SUPABASE_PROJECT_REF;
const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/run-sql-file.mjs <path-to.sql>");
  process.exit(1);
}

const sql = readFileSync(path, "utf8");

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

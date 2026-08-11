#!/usr/bin/env node
// Guards the exact bug the 2026-08-11 CSO audit found: a SECURITY DEFINER
// Postgres function defaults to EXECUTE for PUBLIC, so it becomes callable by
// `anon`/`authenticated` directly via PostgREST (/rest/v1/rpc/<fn>) — bypassing
// every auth check in the API routes. This queries the live DB for any such
// function and fails the push unless it's explicitly allowlisted below.
//
// Rules:
//   - ANY anon-executable SECURITY DEFINER function → hard fail (never allowed).
//   - authenticated-executable → fail unless in ALLOW_AUTHENTICATED (the
//     function must self-guard with auth.uid(), like create_document_atomic).
//   - trigger / event_trigger functions are excluded (Postgres refuses to call
//     them directly, so exposure is moot).
//
// If Supabase creds or network are unavailable, this SKIPS with a warning
// rather than blocking the push — the real enforcement point is a dev machine
// with .env.local. Fix a genuine finding by revoking the grant:
//   node scripts/run-sql.mjs "REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM anon, authenticated, public;"
//
// Note: sets process.exitCode and lets the event loop drain instead of calling
// process.exit(), which on Windows can race undici's socket teardown and crash
// with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)".

import { readFileSync } from "node:fs";

// Functions that are INTENTIONALLY callable by signed-in users and that
// enforce ownership internally (auth.uid() checks). Keep this list tiny and
// justify every entry. anon is never allowed here.
const ALLOW_AUTHENTICATED = new Set([
  // create_document_atomic: checks v_business_user = auth.uid() and raises
  // 'unauthorized' before writing. Verified in the CSO audit.
  "create_document_atomic",
]);

function skip(msg) {
  console.log(`⚠ check-secdef-grants: ${msg} — skipping`);
  process.exitCode = 0;
}

async function main() {
  let env;
  try {
    env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .reduce((acc, line) => {
        const [k, ...rest] = line.split("=");
        if (k) acc[k.trim()] = rest.join("=").trim();
        return acc;
      }, {});
  } catch {
    return skip("no .env.local (run on a dev machine with creds)");
  }

  const TOKEN = env.SUPABASE_ACCESS_TOKEN;
  const REF = env.SUPABASE_PROJECT_REF;
  if (!TOKEN || !REF) return skip("SUPABASE_ACCESS_TOKEN/PROJECT_REF missing");

  const sql = `
SELECT p.proname AS name,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_type t ON t.oid = p.prorettype
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND t.typname NOT IN ('trigger', 'event_trigger')
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
ORDER BY p.proname;`;

  let rows;
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        Connection: "close",
      },
      body: JSON.stringify({ query: sql }),
    });
    if (!r.ok) return skip(`query failed (HTTP ${r.status})`);
    rows = await r.json();
  } catch (e) {
    return skip(`network error (${e.message})`);
  }

  const offenders = [];
  for (const row of rows) {
    if (row.anon) {
      offenders.push({ ...row, why: "executable by anon (never allowed for SECURITY DEFINER)" });
    } else if (row.auth && !ALLOW_AUTHENTICATED.has(row.name)) {
      offenders.push({ ...row, why: "executable by authenticated and not allowlisted" });
    }
  }

  if (offenders.length === 0) {
    console.log("✓ no unexpectedly-exposed SECURITY DEFINER functions");
    process.exitCode = 0;
    return;
  }

  console.error("✗ SECURITY DEFINER function(s) exposed via PostgREST RPC:\n");
  for (const o of offenders) {
    console.error(`  public.${o.name}(${o.args})`);
    console.error(`    → ${o.why}\n`);
  }
  console.error("These are callable directly at /rest/v1/rpc/<fn>, bypassing the API routes.");
  console.error("If server-only, revoke the grant:");
  console.error(`  node scripts/run-sql.mjs "REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM anon, authenticated, public;"`);
  console.error("If intentionally public and self-guarding, add it to ALLOW_AUTHENTICATED in this script.");
  process.exitCode = 1;
}

await main();

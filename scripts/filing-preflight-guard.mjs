#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Nightly PCN874 preflight guard.
 *
 * For every VAT-filing business, builds the PCN874 file for the last ended
 * bi-monthly period with the SAME exported builder /reports/vat uses, and
 * counts which blocking codes hit how many businesses. Only
 * { code, businessesAffected } ever leaves this process: messages can embed
 * amounts, so they are never printed, pushed or stored.
 *
 * Zero-noise: one Gaya push when a code is new or its count grew since the
 * last successful run (state in .filing-preflight-guard-state.json, gitignored).
 *
 * Service role via scripts/admin-unattended.mjs, so every run is logged in
 * admin_access_log as automation.
 *
 *   node --import tsx scripts/filing-preflight-guard.mjs            # real run
 *   node --import tsx scripts/filing-preflight-guard.mjs --dry-run  # table only, no push, no state
 *   node --import tsx scripts/filing-preflight-guard.mjs --no-push  # print the push text, no state
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { adminClientUnattended } from "./admin-unattended.mjs";
import { loadEnv } from "./lib/admin-core.mjs";
import { buildPcn874, pcnBlockingCodes } from "../src/lib/ita/pcn874.ts";
import { biMonthlyRange } from "../src/lib/ita/vat-periods.ts";
import { FILING_COLUMNS, mapFilingDocument, mapFilingExpense } from "../src/lib/filing-rows.ts";
import { countAffectedBusinesses, formatGuardPush, formatGuardTable, newOrGrownCodes } from "../src/lib/filing-guard.ts";

const STATE = new URL("../.filing-preflight-guard-state.json", import.meta.url);
const PAGE = 1000;
const dryRun = process.argv.includes("--dry-run");
const noPush = process.argv.includes("--no-push");
const env = loadEnv();
const sb = adminClientUnattended("filing-preflight-guard.mjs");

async function readAll(build, label) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    // Never echo error details: keep the output to table names and counts.
    if (error || !data) throw new Error(`${label} read failed`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function main() {
  const now = new Date();
  const range = biMonthlyRange(now, -1);
  const businesses = await readAll(
    () => sb.from("businesses").select("id,tax_id,business_type").in("business_type", ["authorized", "company"]).order("id", { ascending: true }),
    "businesses",
  );

  const perBusiness = [];
  let loadFailures = 0;
  for (const b of businesses) {
    try {
      const [docRows, expenseRows] = await Promise.all([
        readAll(() => sb.from("documents").select(FILING_COLUMNS.documents).eq("business_id", b.id).order("id", { ascending: true }), "documents"),
        readAll(() => sb.from("expenses").select(FILING_COLUMNS.expenses).eq("business_id", b.id).order("id", { ascending: true }), "expenses"),
      ]);
      const result = buildPcn874({
        business: { taxId: b.tax_id ?? "", businessType: b.business_type },
        documents: docRows.map(mapFilingDocument),
        expenses: expenseRows.map(mapFilingExpense),
        range,
        generatedOn: now,
      });
      // A business with nothing in the period would only report its settings; skip it.
      if (result.transactions.length === 0 && result.warnings.length === 0) continue;
      perBusiness.push(pcnBlockingCodes(result));
    } catch {
      loadFailures += 1;
    }
  }

  const counts = countAffectedBusinesses(perBusiness);
  if (loadFailures) counts.guard_load_failed = loadFailures;
  console.log(`PCN874 preflight guard, period ${range.start}..${range.end}, businesses with activity: ${perBusiness.length}`);
  console.log(formatGuardTable(counts));
  if (dryRun) return;

  const previous = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")).counts ?? {} : {};
  const changes = newOrGrownCodes(previous, counts);
  const saveState = () => writeFileSync(STATE, JSON.stringify({ updatedAt: now.toISOString(), periodEnd: range.end, counts }, null, 2) + "\n");

  if (changes.length === 0) {
    saveState();
    console.log("no new or grown codes, staying quiet");
    return;
  }
  const text = formatGuardPush(changes, range.label);
  if (noPush) {
    console.log(text);
    return;
  }
  if (!env.GAYA_PUSH_URL || !env.GAYA_PUSH_TOKEN) {
    console.error("GAYA_PUSH_URL / GAYA_PUSH_TOKEN missing in .env.local, cannot push");
    process.exitCode = 1;
    return;
  }
  try {
    const res = await fetch(env.GAYA_PUSH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GAYA_PUSH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, source: "invoice-app-filing-guard" }),
    });
    console.log(`[gaya push] ${res.status}`);
    // State moves only after the push left, so a failed push retries tomorrow.
    if (res.ok) saveState();
    else process.exitCode = 1;
  } catch {
    console.error("[gaya push failed]");
    process.exitCode = 1;
  }
}

// process.exitCode, never process.exit(): exiting while undici holds sockets
// crashes on Windows with a libuv assertion (see check-subscriber-threshold.mjs).
await main();

#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Nightly filing preflight guard.
 *
 * PCN874: for every VAT-filing business, builds the file for the last ended
 * bi-monthly period with the SAME exported builder /reports/vat uses.
 * Invoices-period ("invoices:" codes): the same documents through the SAME
 * preflight /reports/invoices-period uses, counting findings that stop the
 * listing or change its totals.
 * Uniform structure ("uniform:" codes): for every business with activity in
 * the previous tax year, the SAME check the export route runs.
 *
 * Only { code, businessesAffected } ever leaves this process: messages can
 * embed amounts, so they are never printed, pushed or stored.
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
import { invoiceListAffectingCodes, invoiceReportPreflight } from "../src/lib/invoice-report-preflight.ts";
import { checkUniformExport } from "../src/lib/uniform-structure/check.ts";
import { uniformBlockingCodes } from "../src/lib/uniform-structure/issues.ts";
import { groupUniformItems, mapUniformBusiness, mapUniformClient, mapUniformDocument, mapUniformExpense } from "../src/lib/uniform-structure/rows.ts";
import { UNIFORM_SOFTWARE } from "../src/lib/uniform-structure/software.ts";
import { countAffectedBusinesses, formatGuardPush, formatGuardTable, newOrGrownCodes, prefixCodes } from "../src/lib/filing-guard.ts";

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

/** PCN874 + invoices-period for the last ended bi-monthly period. */
async function filingPeriodSection(range, now, perBusiness) {
  const businesses = await readAll(
    () => sb.from("businesses").select("id,tax_id,business_type").in("business_type", ["authorized", "company"]).order("id", { ascending: true }),
    "businesses",
  );
  let active = 0;
  let failures = 0;
  for (const b of businesses) {
    try {
      const [docRows, expenseRows] = await Promise.all([
        readAll(() => sb.from("documents").select(FILING_COLUMNS.documents).eq("business_id", b.id).order("id", { ascending: true }), "documents"),
        readAll(() => sb.from("expenses").select(FILING_COLUMNS.expenses).eq("business_id", b.id).order("id", { ascending: true }), "expenses"),
      ]);
      const documents = docRows.map(mapFilingDocument);
      const invoiceCodes = prefixCodes("invoices", invoiceListAffectingCodes(invoiceReportPreflight(documents, range.start, range.end)));
      const result = buildPcn874({
        business: { taxId: b.tax_id ?? "", businessType: b.business_type },
        documents,
        expenses: expenseRows.map(mapFilingExpense),
        range,
        generatedOn: now,
      });
      // A business with nothing in the period would only report its settings; skip it.
      const pcnActive = result.transactions.length > 0 || result.warnings.length > 0;
      if (!pcnActive && invoiceCodes.length === 0) continue;
      active += 1;
      perBusiness.push([...(pcnActive ? pcnBlockingCodes(result) : []), ...invoiceCodes]);
    } catch {
      failures += 1;
    }
  }
  return { active, failures };
}

/** Uniform structure for the previous tax year, every business type. */
async function uniformSection(year, perBusiness) {
  const businesses = await readAll(
    () => sb.from("businesses").select("id,name,business_type,tax_id,address,phone,email").order("id", { ascending: true }),
    "businesses",
  );
  const inYear = (row) => typeof row.date === "string" && row.date.startsWith(`${year}-`);
  let active = 0;
  let failures = 0;
  for (const b of businesses) {
    try {
      const [clientRows, docRows, expenseRows] = await Promise.all([
        readAll(() => sb.from("clients").select("*").eq("business_id", b.id).order("id", { ascending: true }), "clients"),
        readAll(() => sb.from("documents").select("*").eq("business_id", b.id).order("id", { ascending: true }), "documents"),
        readAll(() => sb.from("expenses").select("*").eq("business_id", b.id).order("id", { ascending: true }), "expenses"),
      ]);
      if (!docRows.some(inYear) && !expenseRows.some(inYear)) continue;
      const itemRows = [];
      const ids = docRows.map((d) => d.id);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        itemRows.push(...await readAll(() => sb.from("document_items").select("*").in("document_id", chunk).order("id", { ascending: true }), "document_items"));
      }
      const items = groupUniformItems(itemRows);
      const { issues } = checkUniformExport(
        {
          business: mapUniformBusiness(b),
          clients: clientRows.map(mapUniformClient),
          documents: docRows.map((row) => mapUniformDocument(row, items.get(row.id) ?? [])),
          expenses: expenseRows.map(mapUniformExpense),
          taxYear: year,
          fromDate: `${year}-01-01`,
          toDate: `${year}-12-31`,
        },
        { sample: false, registrationNumber: UNIFORM_SOFTWARE.registrationNumber },
      );
      active += 1;
      perBusiness.push(prefixCodes("uniform", uniformBlockingCodes(issues)));
    } catch {
      failures += 1;
    }
  }
  return { active, failures };
}

async function main() {
  const now = new Date();
  const range = biMonthlyRange(now, -1);
  const year = now.getFullYear() - 1;
  const perBusiness = [];

  const filing = await filingPeriodSection(range, now, perBusiness);
  const uniform = await uniformSection(year, perBusiness);

  const counts = countAffectedBusinesses(perBusiness);
  const loadFailures = filing.failures + uniform.failures;
  if (loadFailures) counts.guard_load_failed = loadFailures;
  console.log(`PCN874 + invoices-period guard, period ${range.start}..${range.end}, businesses with activity: ${filing.active}`);
  console.log(`uniform structure guard, tax year ${year}, businesses with activity: ${uniform.active}`);
  console.log(formatGuardTable(counts));
  if (dryRun) return;

  const previous = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")).counts ?? {} : {};
  const changes = newOrGrownCodes(previous, counts);
  const saveState = () => writeFileSync(STATE, JSON.stringify({ updatedAt: now.toISOString(), periodEnd: range.end, uniformYear: year, counts }, null, 2) + "\n");

  if (changes.length === 0) {
    saveState();
    console.log("no new or grown codes, staying quiet");
    return;
  }
  const text = formatGuardPush(changes, `${range.label}, מבנה אחיד ${year}`);
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

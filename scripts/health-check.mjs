#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * invoice-app twice-weekly health guardian (LOCAL, full access).
 *
 * Runs the deterministic half of "check everything": live routes, security
 * headers, tax-authority liveness, Vercel deploy freshness, Supabase tax
 * allocation failures, git drift, and dependency vulnerabilities. Pushes a
 * concise status summary to Asaf on WhatsApp via Gaya.
 *
 * Has the repo + .env.local + all tokens, so it sees what a cloud routine
 * can't. The deep "what can be improved" code review still belongs to an
 * interactive Claude session; this catches the breakage and drift.
 *
 * Scheduled by scripts/install-health-task.ps1 (Mon + Thu mornings).
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const ROOT = new URL("..", import.meta.url);
const env = readFileSync(new URL(".env.local", ROOT), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((a, l) => {
    const [k, ...r] = l.split("=");
    if (k) a[k.trim()] = r.join("=").trim();
    return a;
  }, {});

// Still the old host on purpose. This script runs unattended as the
// `invoice-app-health` scheduled task and pushes failures to WhatsApp, so it
// must point at whatever is actually serving RIGHT NOW. friendlyinvoice.co.il
// is bought and wired but its .il delegation has not published yet; pointing
// here early would fire false alarms every run. Flip this literal in the same
// change that sets NEXT_PUBLIC_SITE_ORIGIN. domain-literal-ok
const BASE = process.env.BASE_URL || "https://mysuperfriendlyinvoiceapp.vercel.app";
const PROJECT_ID = env.VERCEL_PROJECT_ID || "prj_TvmyEkfULUU4vcQSvEySbrEhuqGB";
// Gaya push creds come from .env.local (gitignored); never hardcode a secret.
const GAYA_PUSH_URL = env.GAYA_PUSH_URL;
const GAYA_TOKEN = env.GAYA_PUSH_TOKEN;

const ok = [];
const warn = [];
const fail = [];

async function timed(fn) {
  try {
    return await fn();
  } catch (e) {
    return { error: e.message };
  }
}

// 1. Key public routes return 200
async function checkRoutes() {
  const routes = ["/", "/settings", "/login", "/products", "/reports"];
  for (const r of routes) {
    const res = await timed(() => fetch(BASE + r, { redirect: "manual" }));
    const code = res.status || res.error;
    if (res.status === 200) ok.push(`route ${r} 200`);
    else fail.push(`route ${r} → ${code}`);
  }
}

// 2. Security headers present on the homepage
async function checkHeaders() {
  const res = await timed(() => fetch(BASE + "/"));
  if (res.error) { fail.push(`headers: ${res.error}`); return; }
  const need = {
    "strict-transport-security": "HSTS",
    "x-frame-options": "X-Frame-Options",
    "x-content-type-options": "nosniff",
    "referrer-policy": "Referrer-Policy",
  };
  const missing = Object.entries(need)
    .filter(([h]) => !res.headers.get(h))
    .map(([, label]) => label);
  if (missing.length === 0) ok.push("security headers present");
  else fail.push(`missing security headers: ${missing.join(", ")}`);
}

// 3. Tax-authority integration live (not dormant 503)
async function checkTaxLive() {
  const res = await timed(() => fetch(BASE + "/api/tax-authority/connect", { method: "POST" }));
  if (res.status === 401) ok.push("tax-authority integration live (401 gate)");
  else if (res.status === 503) fail.push("tax-authority integration DORMANT (503), env vars dropped?");
  else fail.push(`tax-authority/connect → ${res.status || res.error}`);
}

// 4. Latest production deploy READY and matches local master HEAD
async function checkDeploy() {
  if (!env.VERCEL_ACCESS_TOKEN) { warn.push("VERCEL_ACCESS_TOKEN missing, skipped deploy check"); return; }
  const res = await timed(() =>
    fetch(`https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&target=production&limit=1`, {
      headers: { Authorization: `Bearer ${env.VERCEL_ACCESS_TOKEN}` },
    }),
  );
  if (res.error) { warn.push(`deploy check: ${res.error}`); return; }
  const data = await res.json().catch(() => ({}));
  const dep = data.deployments?.[0];
  if (!dep) { warn.push("no production deployment found"); return; }
  if (dep.state !== "READY") fail.push(`latest deploy state = ${dep.state}`);
  else ok.push("latest production deploy READY");

  let localHead = "";
  try { localHead = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim().slice(0, 7); } catch {}
  const deployedSha = (dep.meta?.githubCommitSha || "").slice(0, 7);
  if (localHead && deployedSha && localHead !== deployedSha) {
    warn.push(`deploy at ${deployedSha} but local HEAD ${localHead}, unpushed work?`);
  }
}

// 5. Tax allocation failures in the DB
async function checkTaxFailures() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    warn.push("Supabase keys missing, skipped allocation-failure check");
    return;
  }
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb
    .from("tax_authority_credentials")
    .select("business_id, last_error");
  if (error) { warn.push(`tax_authority_credentials read: ${error.message}`); return; }
  const failures = (data || []).filter((c) => c.last_error);
  if (failures.length === 0) ok.push(`tax allocations healthy (${(data || []).length} connected, 0 errors)`);
  else fail.push(`${failures.length} business(es) with failed allocation: ${failures.map((f) => f.last_error).join("; ")}`);
}

// 6. Git drift: uncommitted or unpushed
function checkGit() {
  try {
    const dirty = execSync("git status --porcelain", { cwd: ROOT }).toString().trim();
    const trackedDirty = dirty.split("\n").filter((l) => l && !l.startsWith("??")).length;
    if (trackedDirty > 0) warn.push(`${trackedDirty} uncommitted tracked change(s)`);
    const unpushed = execSync("git log origin/master..HEAD --oneline", { cwd: ROOT }).toString().trim();
    if (unpushed) warn.push(`${unpushed.split("\n").length} commit(s) not on master/production`);
    if (trackedDirty === 0 && !unpushed) ok.push("git clean & pushed");
  } catch (e) {
    warn.push(`git check: ${e.message}`);
  }
}

// 7. Dependency vulnerabilities (high/critical only)
function checkDeps() {
  try {
    const out = execSync("npm audit --json", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const j = JSON.parse(out);
    const v = j.metadata?.vulnerabilities || {};
    const sev = (v.critical || 0) + (v.high || 0);
    if (sev === 0) ok.push("no high/critical npm vulns");
    else fail.push(`${v.critical || 0} critical + ${v.high || 0} high npm vulns`);
  } catch (e) {
    // npm audit exits non-zero when vulns exist; parse stdout from the error
    try {
      const j = JSON.parse(e.stdout?.toString() || "{}");
      const v = j.metadata?.vulnerabilities || {};
      const sev = (v.critical || 0) + (v.high || 0);
      if (sev === 0) ok.push("no high/critical npm vulns");
      else fail.push(`${v.critical || 0} critical + ${v.high || 0} high npm vulns`);
    } catch {
      warn.push("npm audit could not be parsed");
    }
  }
}

async function main() {
  await checkRoutes();
  await checkHeaders();
  await checkTaxLive();
  await checkDeploy();
  await checkTaxFailures();
  checkGit();
  checkDeps();

  const status = fail.length ? "🔴" : warn.length ? "🟡" : "🟢";
  const lines = [
    `${status} invoice-app health: ${fail.length} fail / ${warn.length} warn / ${ok.length} ok`,
  ];
  if (fail.length) lines.push("✗ " + fail.join("\n✗ "));
  if (warn.length) lines.push("⚠ " + warn.join("\n⚠ "));
  if (!fail.length && !warn.length) lines.push("הכל תקין: אתר חי, אינטגרציה דלוקה, אין כשלים, deploy מעודכן.");
  const text = lines.join("\n");

  console.log(text);

  // Push to Gaya. --no-push suppresses entirely (testing); --silent skips
  // only an all-green report (zero-noise mode).
  const silentGreen = process.argv.includes("--silent") && !fail.length && !warn.length;
  const noPush = process.argv.includes("--no-push");
  if (!noPush && !silentGreen) {
    if (!GAYA_PUSH_URL || !GAYA_TOKEN) {
      console.error("GAYA_PUSH_URL / GAYA_PUSH_TOKEN missing in .env.local, skipping WhatsApp push");
      process.exit(fail.length ? 1 : 0);
    }
    try {
      const res = await fetch(GAYA_PUSH_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${GAYA_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: "invoice-app-health" }),
      });
      console.log(`\n[gaya push] ${res.status}`);
    } catch (e) {
      console.error(`[gaya push failed] ${e.message}`);
    }
  }

  process.exit(fail.length ? 1 : 0);
}

main();

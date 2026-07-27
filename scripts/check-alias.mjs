// Verifies the canonical alias mysuperfriendlyinvoiceapp.vercel.app points to
// the latest production deployment. If it doesn't, repoints automatically.
//
// AGENTS.md trap #2: the alias does NOT auto-advance when a new deploy goes
// ready. This has bitten us multiple times; most painfully on 2026-05-03,
// when a React #310 fix was deployed but the alias stayed pinned to a
// 3-day-old broken build, so the user kept hitting the same crash.
//
// Usage: node scripts/check-alias.mjs [--repoint]
//   default: read-only, exits 1 if drifted
//   --repoint: drifted? repoint and verify

import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .reduce((a, l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) a[m[1]] = m[2];
    return a;
  }, {});

const TOKEN = env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("missing VERCEL_ACCESS_TOKEN");
  process.exit(2);
}

const PROJECT_ID = "prj_TvmyEkfULUU4vcQSvEySbrEhuqGB";
const ALIAS = "mysuperfriendlyinvoiceapp.vercel.app";
const repoint = process.argv.includes("--repoint");

async function api(path, init = {}) {
  const res = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${path}: ${await res.text()}`);
  }
  return res.json();
}

const aliasInfo = await api(`/v4/aliases/${ALIAS}`);
const deploys = await api(
  `/v6/deployments?projectId=${PROJECT_ID}&target=production&state=READY&limit=1`,
);
const latest = deploys.deployments[0];

if (!latest) {
  console.error("✗ no READY production deployment found");
  process.exit(1);
}

if (aliasInfo.deploymentId === latest.uid) {
  console.log(`✓ alias ${ALIAS} → ${latest.uid.slice(0, 16)} (latest)`);
  process.exit(0);
}

const sha = (latest.meta?.githubCommitSha || "").slice(0, 7);
console.log(`✗ alias drift: alias → ${aliasInfo.deploymentId.slice(0, 16)}, latest → ${latest.uid.slice(0, 16)} (${sha})`);

if (!repoint) {
  console.log("run with --repoint to fix");
  process.exit(1);
}

await api(`/v2/deployments/${latest.uid}/aliases`, {
  method: "POST",
  body: JSON.stringify({ alias: ALIAS }),
});
const recheck = await api(`/v4/aliases/${ALIAS}`);
if (recheck.deploymentId === latest.uid) {
  console.log(`✓ repointed → ${latest.uid.slice(0, 16)}`);
  process.exit(0);
}
console.error("✗ repoint failed, alias still wrong");
process.exit(1);

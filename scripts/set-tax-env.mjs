#!/usr/bin/env node
/* eslint-disable no-console */
// Upsert Tax Authority env vars on the Vercel project (production tier).
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [k, ...rest] = line.split("=");
    if (k) acc[k.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const TOKEN = env.VERCEL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("VERCEL_ACCESS_TOKEN missing in .env.local");
  process.exit(1);
}
// Prefer .env.local override; fall back to the known project id so the
// script keeps working without extra config (matches check-alias.mjs).
const PROJECT_ID = env.VERCEL_PROJECT_ID || "prj_TvmyEkfULUU4vcQSvEySbrEhuqGB";

let vars; // [{key,value}]
try {
  if (!process.argv[2]) throw new Error("missing argument");
  vars = JSON.parse(process.argv[2]);
  if (!Array.isArray(vars)) throw new Error("expected a JSON array");
} catch (e) {
  console.error(
    `Usage: node set-tax-env.mjs '[{"key":"FOO","value":"bar"}]'\n  -> ${e.message}`,
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

for (const { key, value } of vars) {
  try {
    const res = await fetch(
      `https://api.vercel.com/v10/projects/${PROJECT_ID}/env?upsert=true`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          key,
          value,
          // Encrypt all of them — safe default for an env-setting tool. The
        // software number is public-registry data, but encrypting it costs
        // nothing and keeps the whole tax-authority set consistent.
        type: "encrypted",
          target: ["production", "preview", "development"],
        }),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`✗ ${key}: ${res.status} ${JSON.stringify(data)}`);
    } else {
      console.log(`✓ ${key} set (${data.type ?? "ok"})`);
    }
  } catch (e) {
    console.error(`✗ ${key}: network error — ${e.message}`);
  }
}

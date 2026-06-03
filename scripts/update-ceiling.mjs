#!/usr/bin/env node
/* eslint-disable no-console */
// Manual updater for the עוסק פטור annual ceiling.
//
// Usage:
//   node scripts/update-ceiling.mjs 2027 125000
//
// Inserts/updates the YEAR:AMOUNT pair in EXEMPT_CEILING_BY_YEAR
// inside src/lib/tax-thresholds.ts. Doesn't commit — review the diff,
// then `git add src/lib/tax-thresholds.ts && git commit -m "ceiling 2027: ₪125,000"`.

import { readFileSync, writeFileSync } from "node:fs";

const [yearArg, amountArg] = process.argv.slice(2);
const year = Number(yearArg);
const amount = Number(amountArg);

if (!Number.isInteger(year) || year < 2020 || year > 2100) {
  console.error("Bad year. Usage: update-ceiling.mjs <year> <amount>");
  process.exit(1);
}
if (!Number.isInteger(amount) || amount < 10_000 || amount > 10_000_000) {
  console.error("Bad amount. Usage: update-ceiling.mjs <year> <amount>");
  process.exit(1);
}

const path = new URL("../src/lib/tax-thresholds.ts", import.meta.url);
let source = readFileSync(path, "utf8");

// Use underscore-thousands form to match existing style.
const formatted = amount.toLocaleString("en-US").replace(/,/g, "_");

const replaceRe = new RegExp(`(\\b${year}\\s*:\\s*)[0-9_]+`);

if (replaceRe.test(source)) {
  source = source.replace(replaceRe, `$1${formatted}`);
  console.log(`Updated ${year} → ${formatted}`);
} else {
  // Insert before the closing `};` of EXEMPT_CEILING_BY_YEAR.
  const insertionMarker = /export const EXEMPT_CEILING_BY_YEAR[\s\S]*?\{([\s\S]*?)\};/;
  const match = source.match(insertionMarker);
  if (!match) {
    console.error("Couldn't find EXEMPT_CEILING_BY_YEAR block — manual edit required");
    process.exit(2);
  }
  const inner = match[1].trimEnd();
  const newInner = `${inner}\n  ${year}: ${formatted},\n`;
  source = source.replace(insertionMarker, (full) =>
    full.replace(match[1], newInner),
  );
  console.log(`Inserted ${year}: ${formatted}`);
}

writeFileSync(path, source, "utf8");
console.log(`✓ src/lib/tax-thresholds.ts updated. Review with: git diff src/lib/tax-thresholds.ts`);

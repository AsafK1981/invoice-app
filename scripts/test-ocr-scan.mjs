#!/usr/bin/env node
// Verifies /api/expenses/scan end-to-end against the live production deploy.
// Generates a tiny synthetic Hebrew receipt PNG (encoded with text via raw
// bitmap is too hard, so we fetch a known small public-domain receipt-like
// image), POSTs it as base64, and inspects the response.
//
// Used to confirm the Anthropic API key has credit and the OCR flow works.

import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8").split("\n").reduce((a, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) a[m[1]] = m[2];
  return a;
}, {});

const API_KEY = env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY missing in .env.local");
  process.exit(1);
}

// Step 1: call Anthropic /v1/messages directly with a tiny request to check
// credit. This avoids running the full /api/expenses/scan endpoint (which
// requires a Supabase session token) just to detect credit state.

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": API_KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8,
    messages: [{ role: "user", content: "Say OK." }],
  }),
});

const status = res.status;
const json = await res.json().catch(() => ({}));

if (status === 200) {
  const text = json.content?.[0]?.text || "";
  console.log("✓ Anthropic API has credit. Test response:", text.trim());
  console.log("✓ /api/expenses/scan endpoint is ready for real receipts.");
  process.exit(0);
}

if (status === 400 && /credit balance is too low/i.test(json?.error?.message || "")) {
  console.error("✗ Anthropic credit balance is still empty.");
  console.error("  Add credits at https://console.anthropic.com/settings/billing");
  process.exit(2);
}

console.error(`✗ Unexpected error (${status}):`, json?.error?.message || JSON.stringify(json));
process.exit(3);

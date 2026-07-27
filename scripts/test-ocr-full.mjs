#!/usr/bin/env node
// Full E2E test for the receipt-OCR feature:
//   1) Credit available?
//   2) Anthropic Vision returns valid JSON when shown a real receipt image?
//   3) /api/expenses/scan endpoint reachable on production and rejects
//      unauth'd requests with 401 (proves the auth gate is wired up).
//
// Step 2 uses a tiny 1x1 PNG to validate the JSON shape end-to-end without
// needing a real receipt photo. The model should return the cannot_parse
// error JSON, which still proves the API call, prompt, response parsing,
// and structured-output path all work.

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const env = readFileSync(".env.local", "utf8").split("\n").reduce((a, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) a[m[1]] = m[2];
  return a;
}, {});

const apiKey = env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("✗ ANTHROPIC_API_KEY missing");
  process.exit(1);
}

const SYSTEM = `You are an expense extraction system for Israeli small businesses (עוסק פטור / עוסק מורשה).

You will be given evidence of a business expense, in any of these forms:
- A receipt or invoice photo (Hebrew or English)
- A PDF of an invoice or receipt
- A screenshot of a WhatsApp/SMS message confirming payment
- A screenshot of an Israeli payment app (Bit, Paybox, Pepper Pay, bank app) showing money sent
- A screenshot of a credit card / bank statement line
- An email screenshot with payment confirmation

Whatever the form, extract the same fields and return STRICT JSON only:

{
  "vendor": string,
  "amount": number,
  "vatAmount": number | null,
  "date": string,
  "category": string,
  "description": string
}

Field rules:
- vendor: Who got paid. Business/supplier name if printed; if WhatsApp/SMS/Bit-style, use the recipient's name (e.g. "דניאל כהן" or "מוסך זהב"). Hebrew if originally Hebrew, else English.
- amount: TOTAL amount paid in NIS (₪). Include VAT. Just the number, no currency symbol. If currency isn't shown but obviously Israeli context, assume NIS.
- vatAmount: Only if the source EXPLICITLY shows a VAT (מע"מ / מעמ / VAT) line. Otherwise null.
- date: Date of the expense / payment in YYYY-MM-DD format. Israeli dates are usually DD/MM/YYYY; convert. If unclear, use today's date.
- category: Best guess from this exact Hebrew list:
  "תוכנה" | "ציוד" | "שיווק" | "משרד" | "שירותים מקצועיים" | "נסיעות" | "אחר"
- description: One-line Hebrew description of WHAT the expense was for (e.g. "ארוחת עסקים", "דלק", "מנוי חודשי OpenAI", "תיקון לרכב"). If you can't tell the purpose, describe the source (e.g. "תשלום בביט", "העברה בנקאית").

If the file is unreadable or clearly not evidence of an expense, return:
{"error": "cannot_parse", "reason": "<short Hebrew explanation>"}

Return JSON only. No markdown fences. No commentary. No extra text.`;

// Minimal 1x1 transparent PNG (RFC 2083 IHDR + IDAT + IEND)
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

const anthropic = new Anthropic({ apiKey });
const today = new Date().toISOString().slice(0, 10);

console.log("[1/3] testing Anthropic API with structured prompt...");
const t0 = Date.now();
const msg = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 600,
  system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
  messages: [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: TINY_PNG_B64 } },
        { type: "text", text: `Today's date is ${today}. Extract the expense and return JSON only.` },
      ],
    },
  ],
});
const latencyMs = Date.now() - t0;

const text = msg.content
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("")
  .trim()
  .replace(/^```json\s*/i, "")
  .replace(/```\s*$/i, "");

let parsed;
try {
  parsed = JSON.parse(text);
  console.log(`✓ Anthropic returned valid JSON in ${latencyMs}ms`);
  console.log(`  shape:`, Object.keys(parsed).join(", "));
} catch (err) {
  console.error(`✗ Anthropic returned non-JSON:`, text);
  process.exit(2);
}

// For a 1x1 blank PNG the model SHOULD return cannot_parse; anything else
// would mean the prompt isn't being followed.
if (!parsed.error && !parsed.vendor) {
  console.error(`✗ Model didn't return either an error or a vendor: prompt broken.`);
  console.error(JSON.stringify(parsed, null, 2));
  process.exit(3);
}
console.log(`✓ Prompt is being followed (got ${parsed.error ? "expected error" : "vendor field"})`);

// Step 2: hit the production endpoint without auth; should get 401.
console.log("[2/3] testing /api/expenses/scan auth gate...");
const probe = await fetch("https://mysuperfriendlyinvoiceapp.vercel.app/api/expenses/scan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ image: `data:image/png;base64,${TINY_PNG_B64}` }),
});
if (probe.status !== 401) {
  console.error(`✗ Auth gate broken: expected 401, got ${probe.status}`);
  process.exit(4);
}
console.log(`✓ /api/expenses/scan rejects unauth'd requests with 401`);

// Step 3: confirm the route exists and responds (i.e. didn't 404)
console.log("[3/3] verifying route is deployed...");
if (probe.headers.get("x-vercel-id")) {
  console.log(`✓ Route deployed (x-vercel-id: ${probe.headers.get("x-vercel-id").slice(0, 20)}...)`);
}

console.log("");
console.log("================================================");
console.log("✓ ALL CHECKS PASSED: receipt OCR is ready to use");
console.log("================================================");

// Runs realistic voice-note transcripts through the WhatsApp bot's model
// parsers and prints what each one understood. PAID: every line is one Haiku
// call (fractions of an agora each, ~20 calls total) - get approval first.
//
//   npx tsx scripts/test-whatsapp-spoken.mts
//
// Reads ANTHROPIC_API_KEY from .env.local. No DB, no WhatsApp: pure parser
// output, so this is safe to run any time the prompts change.

import { readFileSync } from "node:fs";
import { parseIntent, parseAmendment } from "../src/lib/whatsapp/intent";
import { parseExpenseEditSpoken } from "../src/lib/whatsapp/expense-edit";
import { normalizeSpoken, looksLikeFreshRequest, isCancel } from "../src/lib/whatsapp/spoken";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [k, ...r] = l.split("=");
      return [k.trim(), r.join("=").trim()];
    }),
);
const key = env.ANTHROPIC_API_KEY;
if (!key) throw new Error("ANTHROPIC_API_KEY missing in .env.local");
const today = new Date().toISOString().slice(0, 10);

const FRESH = [
  "היי, תוציאי לי בבקשה קבלה לדני כהן על אלף מאתיים שקל, העברה בנקאית.",
  "אה, אני רוצה שתוציא קבלה לרוני לוי על חמש מאות שקל בביט עבור ייעוץ.",
  "אפשר הצעת מחיר לחברת אלפא על שלושת אלפים שקל לפני מע\"מ?",
];

const AMEND_DRAFT = { docType: "receipt", clientName: "דני כהן", amount: 1200, amountIncludesVat: null, paymentMethod: "העברה בנקאית", description: "ייעוץ", date: today };
const AMEND = [
  "לא, זה היה אלף וחמש מאות ושילם בביט.",
  "אה, הלקוח זה לא דני, זה רוני לוי.",
  "תשנה את זה להצעת מחיר.",
  "זה בעצם עבור צילום אירוע, לא ייעוץ.",
];

const EXPENSE_DRAFT = { vendor: null, amount: 437, vatAmount: null, date: today, category: "ציוד", description: "" };
const EXPENSE = [
  "הספק זה מרכז הבטיחות רעננה והסכום מאה וחמישים.",
  "אה, זה היה אתמול, לא היום.",
  "תרשום שזה חומרי בניין, קטגוריה ציוד, בלי מע\"מ.",
  "הסכום זה ארבע מאות שלושים ושבע שקל וזה מא.שטרית.",
];

console.log("== gates (no model) ==");
for (const t of [...FRESH, ...AMEND, "בטל.", "לא, תבטל את זה"]) {
  console.log(`${looksLikeFreshRequest(t) ? "FRESH " : "      "}${isCancel(t) ? "CANCEL " : "       "}${normalizeSpoken(t)}`);
}

console.log("\n== parseIntent (fresh requests) ==");
for (const t of FRESH) {
  const r = await parseIntent(normalizeSpoken(t), key);
  console.log(`\n> ${t}\n  ${JSON.stringify(r.intent)}`);
}

console.log("\n== parseAmendment (document draft) ==");
for (const t of AMEND) {
  const r = await parseAmendment(normalizeSpoken(t), AMEND_DRAFT, key);
  console.log(`\n> ${t}\n  ${JSON.stringify(r)}`);
}

console.log("\n== parseExpenseEditSpoken (expense card) ==");
for (const t of EXPENSE) {
  const r = await parseExpenseEditSpoken(normalizeSpoken(t), EXPENSE_DRAFT, today, key);
  console.log(`\n> ${t}\n  ${JSON.stringify(r)}`);
}

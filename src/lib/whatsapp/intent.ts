// Turns a free-text Hebrew WhatsApp message into a structured intent.
//
// Deliberately conservative. Anything this returns becomes a DRAFT that the user
// must confirm with a button tap, never a write — but the draft is still what
// the user reads and approves at a glance, so a confident wrong answer is worse
// than an admitted "I didn't understand". The prompt is written to prefer
// `unknown` over guessing, and every numeric field is re-validated in TypeScript
// afterwards rather than trusted.

import Anthropic from "@anthropic-ai/sdk";
import { todayInIsrael } from "@/lib/date";
import { round2 } from "@/lib/vat";

const MODEL = "claude-haiku-4-5-20251001";

/**
 * Only receipts and quotes. See the type allowlist in
 * scripts/migrations/20260808-whatsapp-channel.sql for the full reasoning: a
 * חשבונית מס can require a מספר הקצאה, and this channel has no gate for that
 * and no way to capture the customer's tax id. Kept in sync with the RPC by
 * hand — widening one without the other just moves the failure from a helpful
 * chat reply to a raised exception after the user already tapped confirm.
 */
export type BotDocType = "receipt" | "quote";

export interface CreateDocumentIntent {
  intent: "create_document";
  docType: BotDocType;
  clientName: string;
  /** Amount as the user said it, in NIS. VAT handling is decided in code. */
  amount: number;
  /** True when the user said the amount already includes VAT ("כולל מע\"מ"). */
  amountIncludesVat: boolean;
  paymentMethod: string | null;
  description: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface SimpleIntent {
  intent: "help" | "status" | "unknown" | "unavailable_doc_type";
  /** Hebrew, shown to the user verbatim when intent is "unknown". */
  reason?: string;
}

export type Intent = CreateDocumentIntent | SimpleIntent;

const SYSTEM = `You extract intent from Hebrew WhatsApp messages sent by Israeli freelancers (עוסק פטור / עוסק מורשה) to their invoicing app's bot.

Return STRICT JSON only. No markdown fences, no commentary.

One of these shapes:

{"intent":"create_document","docType":"receipt"|"quote","clientName":string,"amount":number,"amountIncludesVat":boolean,"paymentMethod":string|null,"description":string,"date":"YYYY-MM-DD"}

{"intent":"help"}
{"intent":"status"}
{"intent":"unavailable_doc_type"}
{"intent":"unknown","reason":"<short Hebrew explanation of what is missing>"}

Rules:
- docType: ONLY "receipt" or "quote" exist on this channel. "קבלה" -> receipt. "הצעת מחיר" -> quote. Bare "חשבונית" -> receipt (the common case for an עוסק פטור, and the safest: it is not a VAT document).
- If the user explicitly asks for a "חשבונית מס" or "חשבונית מס קבלה", return {"intent":"unavailable_doc_type"} — do NOT quietly downgrade it to a receipt. Those are different legal documents and silently substituting one would be worse than saying no.
- clientName: the customer's name exactly as written. Do NOT invent, translate, or correct it.
- amount: a positive number in NIS. Understand "אלף" = 1000, "אלפיים" = 2000, "1.2k" = 1200, "500 שח" = 500. If NO amount is stated, return unknown - never guess an amount.
- amountIncludesVat: true only if the user explicitly said the amount includes VAT ("כולל מעמ" / "כולל מע\\"מ"). Otherwise false.
- paymentMethod: one of "מזומן" | "העברה בנקאית" | "אשראי" | "ביט" | "צ׳ק" | "פייפאל", or null if not stated. Do not guess.
- description: one short Hebrew line describing what was paid for. If the user did not say, use the document type in words (e.g. "שירותי צילום" only if stated, otherwise "תשלום").
- date: the stated date in YYYY-MM-DD. "אתמול" = yesterday, "היום" = today. Default to today.
- Return "unknown" whenever the customer name OR the amount is missing or ambiguous. A missing detail is normal and asking again is cheap; a wrong tax document is not.
- Anything that is not a request to create a document, and not a general question about how the bot works, is "unknown".`;

export interface ParseResult {
  intent: Intent;
  /** True when the model itself could not be reached / returned garbage. */
  failed: boolean;
}

export async function parseIntent(
  text: string,
  apiKey: string,
): Promise<ParseResult> {
  const today = todayInIsrael();
  try {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Today is ${today} (Asia/Jerusalem).\n\nMessage:\n${text}`,
        },
      ],
    });

    const raw = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "");

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { intent: validateIntent(parsed, today), failed: false };
  } catch (err) {
    console.error(
      "[whatsapp] intent parse failed:",
      err instanceof Error ? err.message : err,
    );
    return { intent: { intent: "unknown" }, failed: true };
  }
}

const DOC_TYPES: BotDocType[] = ["receipt", "quote"];

/** Days either side of today a bot-issued document may be dated. */
const DATE_WINDOW_DAYS = 400;

/**
 * True when `iso` is a real calendar date within a sane window of today.
 *
 * The round-trip through Date is what rejects "2026-02-31": Date normalises it
 * to March 3rd, so the re-serialised string no longer matches the input.
 */
function isPlausibleDate(iso: string, today: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  if (d.toISOString().slice(0, 10) !== iso) return false;
  const ref = new Date(`${today}T00:00:00Z`).getTime();
  const deltaDays = Math.abs(d.getTime() - ref) / 86_400_000;
  return deltaDays <= DATE_WINDOW_DAYS;
}
const PAYMENT_METHODS = ["מזומן", "העברה בנקאית", "אשראי", "ביט", "צ׳ק", "פייפאל"];

/**
 * Re-checks every field the model produced.
 *
 * The model is a parser, not an authority: it can return a negative amount, a
 * doc type outside the allowlist, or a date in the wrong century, and any of
 * those would flow straight into a draft the user might approve without
 * reading closely. Anything that fails here degrades to "unknown", which just
 * asks the user to rephrase.
 */
export function validateIntent(p: Record<string, unknown>, today: string): Intent {
  const intent = String(p.intent || "");

  if (intent === "help" || intent === "status" || intent === "unavailable_doc_type") {
    return { intent };
  }

  if (intent !== "create_document") {
    const reason = typeof p.reason === "string" ? p.reason : undefined;
    return { intent: "unknown", reason };
  }

  const docType = String(p.docType || "");
  if (!DOC_TYPES.includes(docType as BotDocType)) {
    return { intent: "unknown", reason: "לא הבנתי איזה סוג מסמך להפיק." };
  }

  const clientName = String(p.clientName || "").trim();
  if (clientName.length < 2 || clientName.length > 120) {
    return { intent: "unknown", reason: "חסר שם הלקוח." };
  }

  const amount = Number(p.amount);
  // Upper bound is a sanity rail, not a business rule: it catches a decimal-point
  // misread (500 -> 500000) before it becomes an immutable document.
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return { intent: "unknown", reason: "חסר סכום, או שהסכום לא הגיוני." };
  }

  let paymentMethod: string | null = null;
  if (typeof p.paymentMethod === "string" && PAYMENT_METHODS.includes(p.paymentMethod)) {
    paymentMethod = p.paymentMethod;
  }

  // Shape alone is not enough. "2026-02-31" matches the regex and Postgres
  // would reject it only after the user has already tapped confirm, and
  // "1900-01-01" is a perfectly valid date that has no business landing on an
  // immutable document. Round-tripping through Date catches the first; the
  // window catches the second. Anything suspect falls back to today rather
  // than failing the whole request, since the date is shown in the draft the
  // user approves.
  let date = typeof p.date === "string" ? p.date : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isPlausibleDate(date, today)) {
    date = today;
  }

  const description = String(p.description || "").trim().slice(0, 200) || "תשלום";

  return {
    intent: "create_document",
    docType: docType as BotDocType,
    clientName,
    amount: round2(amount),
    amountIncludesVat: p.amountIncludesVat === true,
    paymentMethod,
    description,
    date,
  };
}

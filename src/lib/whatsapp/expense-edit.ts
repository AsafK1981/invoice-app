// Parses the free-text corrections a user sends after tapping "ערוך" on a
// WhatsApp expense card ("סכום 120", "תאריך 26/07/2026", "ספק כנען סנטר",
// ...). Deterministic on purpose: this runs on every text message while an
// expense is in edit mode, so it must be free, instant and predictable, and a
// misread here would put a wrong number in the user's books just as surely as
// a misread of the receipt. Anything it does not understand is reported back
// as such, never guessed.

import Anthropic from "@anthropic-ai/sdk";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/expense-scan";

export interface ExpenseEditPatch {
  vendor?: string;
  amount?: number;
  vatAmount?: number | null;
  date?: string;
  category?: ExpenseCategory;
  description?: string;
}

export interface ExpenseEditResult {
  patch: ExpenseEditPatch;
  /** Lines we could not interpret, verbatim, so the reply can quote them. */
  unrecognized: string[];
}

const KEYS = {
  vendor: /^(?:ספק|שם(?:\s+ספק)?|עסק|חנות|vendor|supplier)\s*[:\-]?\s*(.+)$/i,
  amount: /^(?:סכום|סה"?כ|סה״כ|מחיר|amount|total)\s*[:\-]?\s*(.+)$/i,
  vat: /^(?:מע"מ|מע״מ|מעמ|vat)\s*[:\-]?\s*(.+)$/i,
  date: /^(?:תאריך|date)\s*[:\-]?\s*(.+)$/i,
  category: /^(?:קטגוריה|category)\s*[:\-]?\s*(.+)$/i,
  description: /^(?:תיאור|פירוט|הערה|description)\s*[:\-]?\s*(.+)$/i,
};

/**
 * @param text   the whole message body
 * @param today  YYYY-MM-DD in Israel, used to complete a "26/7" style date
 */
export function parseExpenseEdit(text: string, today: string): ExpenseEditResult {
  const patch: ExpenseEditPatch = {};
  const unrecognized: string[] = [];

  const lines = text
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    let m: RegExpMatchArray | null;

    if ((m = line.match(KEYS.vendor))) {
      const v = m[1].trim();
      if (v) patch.vendor = v.slice(0, 120);
      else unrecognized.push(line);
      continue;
    }
    if ((m = line.match(KEYS.amount))) {
      const n = parseMoney(m[1]);
      if (n != null && n > 0) patch.amount = n;
      else unrecognized.push(line);
      continue;
    }
    if ((m = line.match(KEYS.vat))) {
      const raw = m[1].trim();
      if (/^(0|אין|ללא|בלי|none)$/i.test(raw)) {
        patch.vatAmount = null;
        continue;
      }
      const n = parseMoney(raw);
      if (n != null && n >= 0) patch.vatAmount = n === 0 ? null : n;
      else unrecognized.push(line);
      continue;
    }
    if ((m = line.match(KEYS.date))) {
      const d = parseIsraeliDate(m[1], today);
      if (d) patch.date = d;
      else unrecognized.push(line);
      continue;
    }
    if ((m = line.match(KEYS.category))) {
      const c = matchCategory(m[1]);
      if (c) patch.category = c;
      else unrecognized.push(line);
      continue;
    }
    if ((m = line.match(KEYS.description))) {
      const v = m[1].trim();
      if (v) patch.description = v.slice(0, 200);
      else unrecognized.push(line);
      continue;
    }

    // Keyword-less shortcuts: a bare number is the amount, a bare date is the
    // date, a bare category name is the category. Anything else is unknown -
    // we do NOT assume a bare word is the vendor, that is how typos become
    // supplier names.
    const bareDate = parseIsraeliDate(line, today);
    if (bareDate) {
      patch.date = bareDate;
      continue;
    }
    const bareCat = matchCategory(line);
    if (bareCat) {
      patch.category = bareCat;
      continue;
    }
    const bareNum = /^[\d.,]+\s*(?:₪|ש"ח|ש״ח|שח|nis|ils)?$/i.test(line) ? parseMoney(line) : null;
    if (bareNum != null && bareNum > 0) {
      patch.amount = bareNum;
      continue;
    }
    unrecognized.push(line);
  }

  return { patch, unrecognized };
}

function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[₪\s]|ש"ח|ש״ח|שח|nis|ils/gi, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n > 10_000_000) return null;
  return Math.round(n * 100) / 100;
}

/** DD/MM/YYYY, DD.MM.YY, DD-MM, or YYYY-MM-DD → YYYY-MM-DD, or null. */
export function parseIsraeliDate(raw: string, today: string): string | null {
  const s = raw.trim();
  let y: number, mo: number, d: number;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/))) {
    d = +m[1]; mo = +m[2];
    const ty = +today.slice(0, 4);
    if (m[3] == null) y = ty;
    else y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    // "26/7" with no year: if that lands in the future, they meant last year.
    if (m[3] == null && iso(y, mo, d) > today) y = ty - 1;
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const out = iso(y, mo, d);
  // Tomorrow at most (timezone slack); receipts are not from the future.
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 1);
  if (dt.getTime() > limit.getTime()) return null;
  return out;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function matchCategory(raw: string): ExpenseCategory | null {
  const s = raw.trim().replace(/["״׳']/g, "");
  const hit = (EXPENSE_CATEGORIES as readonly string[]).find((c) => c === s);
  return (hit as ExpenseCategory | undefined) ?? null;
}

// ── spoken / free-form corrections ──────────────────────────────────────────
//
// The deterministic parser above is what runs first, and it stays the only
// path for keyworded lines. But a voice note is a sentence: "אה, הספק זה מרכז
// הבטיחות והסכום מאה וחמישים" has no "ספק"/"סכום" at a line start and its
// number is spelled out, so the regexes reject every word of it and the user
// is told "לא הבנתי מה לשנות" for something they said perfectly clearly. When
// the regexes find NOTHING, the same sentence goes to the model - the same
// Haiku call the document draft already makes for its corrections - and the
// result is re-validated with the same rails (parseMoney, parseIsraeliDate,
// matchCategory), so the model cannot put a value in the books the typed path
// would have refused.

const MODEL = "claude-haiku-4-5-20251001";

const SPOKEN_SYSTEM = `The user is correcting a DRAFT expense (a scanned receipt) in a Hebrew WhatsApp bot. The correction is often a transcribed VOICE NOTE: spoken Hebrew with fillers, a full sentence instead of "field value", numbers spelled out as words. You get the current draft as JSON and the correction. Return STRICT JSON with ONLY the fields that should change:

{"vendor"?: string, "amount"?: number, "vatAmount"?: number|null, "date"?: "YYYY-MM-DD", "category"?: ${JSON.stringify(EXPENSE_CATEGORIES)}, "description"?: string}

or {"unknown":"<short Hebrew explanation>"} when the message is not a correction you can map.

Rules:
- Include a key ONLY if the user asked to change it. Never repeat unchanged fields.
- amount: the TOTAL paid, positive number in NIS. Understand spelled-out numbers: "מאה וחמישים" = 150, "אלף מאתיים" = 1200, "ארבע מאות שלושים ושבע" = 437, "שמונים ותשע תשעים" = 89.90. "הסכום זה X" / "זה עלה X" / "שילמתי X" -> {"amount":X}. A bare number alone is the amount.
- vatAmount: only when the user talks about מע"מ explicitly. "אין מע"מ" / "בלי מע"מ" -> {"vatAmount":null}.
- vendor: "הספק זה X" / "זה מ-X" / "קניתי ב-X" / "החנות X" -> {"vendor":"X"} exactly as said, without the leading "מ"/"ב" preposition.
- date: "אתמול" = yesterday, "היום" = today, "שלשום" = two days ago, or an explicit day/month -> "YYYY-MM-DD". Never a future date.
- category: only one of the listed values, only when the user names one or clearly describes it ("זה לרכב" -> "רכב" if that is in the list). Otherwise omit.
- description: "זה עבור X" / "קניתי X" / "התיאור X" -> {"description":"X"}.
- A message that is a NEW request (issue a receipt, a question, small talk) is not a correction: return unknown.
- No markdown, no commentary.`;

/**
 * Model fallback for the corrections the regexes could not read. Returns the
 * same shape as parseExpenseEdit; `failed` is true only when the model itself
 * was unreachable or returned garbage, so the caller can word the reply.
 */
export async function parseExpenseEditSpoken(
  text: string,
  current: Record<string, unknown>,
  today: string,
  apiKey: string,
): Promise<{ patch: ExpenseEditPatch; unknown?: string; failed: boolean }> {
  try {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: [{ type: "text", text: SPOKEN_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Today is ${today} (Asia/Jerusalem).\n\nCurrent draft:\n${JSON.stringify(current)}\n\nCorrection:\n${text}`,
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
    return { ...validateSpokenExpenseEdit(parsed, today), failed: false };
  } catch (err) {
    console.error("[whatsapp] spoken expense edit parse failed:", err instanceof Error ? err.message : err);
    return { patch: {}, unknown: "לא הצלחתי לעבד את התיקון.", failed: true };
  }
}

/**
 * The rails for the model's answer, key by key. Everything the typed parser
 * refuses (a negative amount, a future date, a category off the list) is
 * dropped here too, so the two paths cannot disagree about what is allowed.
 * Exported for tests.
 */
export function validateSpokenExpenseEdit(
  p: Record<string, unknown>,
  today: string,
): { patch: ExpenseEditPatch; unknown?: string } {
  if (typeof p.unknown === "string" && p.unknown.trim()) {
    return { patch: {}, unknown: p.unknown.trim().slice(0, 200) };
  }
  const patch: ExpenseEditPatch = {};
  if (typeof p.vendor === "string" && p.vendor.trim()) patch.vendor = p.vendor.trim().slice(0, 120);
  if (p.amount !== undefined && p.amount !== null) {
    const n = parseMoney(String(p.amount));
    if (n != null && n > 0) patch.amount = n;
  }
  if ("vatAmount" in p) {
    if (p.vatAmount === null) patch.vatAmount = null;
    else {
      const n = parseMoney(String(p.vatAmount));
      if (n != null && n >= 0) patch.vatAmount = n === 0 ? null : n;
    }
  }
  if (typeof p.date === "string") {
    const d = parseIsraeliDate(p.date, today);
    if (d) patch.date = d;
  }
  if (typeof p.category === "string") {
    const c = matchCategory(p.category);
    if (c) patch.category = c;
  }
  if (typeof p.description === "string" && p.description.trim()) patch.description = p.description.trim().slice(0, 200);
  if (Object.keys(patch).length === 0) return { patch, unknown: "לא הבנתי מה לשנות." };
  return { patch };
}

/** The instruction text sent when the user taps ערוך. */
export const EDIT_INSTRUCTIONS = [
  "מה לשנות? אפשר פשוט לכתוב או להקליט, למשל:",
  "״הספק זה כנען סנטר והסכום 150״",
  "",
  "או שורה לכל שדה:",
  "סכום 120",
  "ספק כנען סנטר",
  "תאריך 26/07/2026",
  "מע״מ 18.3 (או: מע״מ אין)",
  `קטגוריה ${EXPENSE_CATEGORIES.slice(0, -1).join(" / ")}`,
  "תיאור לוח גבס",
  "",
  "או ״בטל״.",
].join("\n");

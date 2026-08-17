// Shared receipt / expense-evidence extraction.
//
// ONE implementation for both callers (/api/expenses/scan and the WhatsApp
// bot's photo handler). Before 2026-08-17 each had its own thin Haiku prompt
// that told the model "if unclear, use today's date" and required vendor +
// amount to be present - so when the model could not read a field it made
// one up, and the user got a confidently wrong vendor / amount / date.
//
// Design rules (Asaf, 2026-08-17: "if it can't read something, leave it
// blank - never fill in something wrong"):
//   1. Every field is nullable. null means "not clearly legible / absent".
//   2. The model must first TRANSCRIBE the lines it is reading from
//      (evidence.*), then fill fields ONLY from that transcription. A field
//      whose evidence line is null is forced to null server-side, so a value
//      cannot appear without the text that supports it.
//   3. Server-side sanity checks (date is a real date, not in the future,
//      VAT <= amount, ...) null out anything implausible instead of passing
//      it through.
//   4. Never default the date to today. The form / bot decide what to do
//      with a missing date and say so to the user.

import Anthropic from "@anthropic-ai/sdk";

// Vision-capable model with high-resolution image input (2576px long edge)
// and adaptive thinking on by default. Haiku 4.5 (the previous model) tops
// out at 1568px and read Hebrew receipts poorly. Model choice is a cost
// decision made with Asaf on 2026-08-17.
export const SCAN_MODEL = "claude-sonnet-5";

export const EXPENSE_CATEGORIES = [
  "תוכנה",
  "ציוד",
  "שיווק",
  "משרד",
  "שירותים מקצועיים",
  "נסיעות",
  "אחר",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
export type ScanMediaType = ImageMediaType | "application/pdf";

export interface ScanFields {
  vendor: string | null;
  amount: number | null;
  vatAmount: number | null;
  /** YYYY-MM-DD or null. Never defaulted to today here. */
  date: string | null;
  category: ExpenseCategory;
  description: string | null;
  /** Human-readable Hebrew names of the fields the model could not read. */
  unreadFields: string[];
  /** Model's own read of how legible the source was. */
  legibility: "good" | "partial" | "unreadable";
  documentKind: string;
}

export type ScanOutcome =
  | { ok: true; fields: ScanFields }
  | {
      ok: false;
      /** not_expense = model says this is not evidence of an expense.
       *  unreadable = nothing usable could be read.
       *  bad_response = the model returned something we could not parse. */
      reason: "not_expense" | "unreadable" | "bad_response";
      /** Short Hebrew explanation suitable for the UI. */
      message: string;
      raw?: string;
    };

const SYSTEM = `You are a meticulous data-entry clerk extracting ONE business expense from an image or PDF for an Israeli small business (עוסק פטור / עוסק מורשה). The evidence may be a printed receipt or tax invoice (Hebrew or English), a PDF invoice, a screenshot of a payment app (Bit, Paybox, bank transfer), a WhatsApp/SMS payment confirmation, or a credit-card statement line.

Accuracy matters far more than completeness. A blank field is fine; a wrong field is a serious error - the user will save it into their books.

WORK IN TWO STEPS.

Step 1 - transcribe evidence. Look at the whole image carefully (rotate mentally if needed). Copy, character for character, the exact text you can read for:
- vendor_lines: the business / recipient name as printed (Hebrew stays Hebrew). Include the line with the ח.פ / ע.מ / עוסק מורשה number if present. If you cannot read a name clearly, leave the list empty.
- total_line: the single line that states the grand total actually paid (סה"כ לתשלום / סה"כ / סך הכל / TOTAL / שולם / הועבר). Copy it including the number and currency symbol. If there are several candidate totals and it is not clear which is the final amount paid, set null.
- vat_line: the line that explicitly states VAT (מע"מ / מעמ / VAT) as an amount. null if there is no such line.
- date_line: the line containing the transaction / payment date exactly as printed (e.g. "תאריך: 03/07/2026" or "17.08.26 14:22"). null if no date is visible or it is not fully legible.

Step 2 - fill the fields ONLY from what you transcribed in step 1.
- vendor: the business or recipient name, cleaned (no ח.פ number, no address, no "בע"מ" removed - keep it as the business writes it). null if vendor_lines is empty or the name is only partly legible. Never invent a plausible name.
- amount: the number from total_line, in NIS, as a plain number. This is the FINAL amount paid including VAT. Do not compute it from line items; do not pick a subtotal, a "before VAT" figure, or a tip. If the currency is clearly not NIS (USD/EUR) still return the number and mention the currency in description. null if total_line is null.
- vatAmount: the number from vat_line. null if vat_line is null. Never derive it by percentage.
- date: the date from date_line converted to YYYY-MM-DD. Israeli sources use DD/MM/YYYY or DD.MM.YY (day first). Two-digit years are 20YY. If the day/month order is genuinely ambiguous, or the year is missing, or any digit is unclear, return null. NEVER use today's date or guess a date.
- category: one of "תוכנה" | "ציוד" | "שיווק" | "משרד" | "שירותים מקצועיים" | "נסיעות" | "אחר". Use "אחר" unless the evidence clearly indicates otherwise.
- description: one short Hebrew line saying what was bought / paid for, only if the evidence shows it (e.g. "דלק", "ארוחת עסקים", "מנוי חודשי"). null if you cannot tell.
- document_kind: what the evidence is.
- legibility: "good" if you read every field you filled with confidence, "partial" if some text was hard to read, "unreadable" if you could not read anything reliable.

Return the JSON object only.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "evidence",
    "document_kind",
    "vendor",
    "amount",
    "vatAmount",
    "date",
    "category",
    "description",
    "legibility",
  ],
  properties: {
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["vendor_lines", "total_line", "vat_line", "date_line"],
      properties: {
        vendor_lines: { type: "array", items: { type: "string" } },
        total_line: { type: ["string", "null"] },
        vat_line: { type: ["string", "null"] },
        date_line: { type: ["string", "null"] },
      },
    },
    document_kind: {
      type: "string",
      enum: [
        "receipt",
        "tax_invoice",
        "invoice",
        "payment_app_screenshot",
        "bank_transfer",
        "card_statement",
        "message_confirmation",
        "other_expense_evidence",
        "not_an_expense",
      ],
    },
    vendor: { type: ["string", "null"] },
    amount: { type: ["number", "null"] },
    vatAmount: { type: ["number", "null"] },
    date: { type: ["string", "null"] },
    category: { type: "string", enum: [...EXPENSE_CATEGORIES] },
    description: { type: ["string", "null"] },
    legibility: { type: "string", enum: ["good", "partial", "unreadable"] },
  },
} as const;

interface RawScan {
  evidence?: {
    vendor_lines?: unknown;
    total_line?: unknown;
    vat_line?: unknown;
    date_line?: unknown;
  };
  document_kind?: unknown;
  vendor?: unknown;
  amount?: unknown;
  vatAmount?: unknown;
  date?: unknown;
  category?: unknown;
  description?: unknown;
  legibility?: unknown;
  error?: unknown;
}

const IMAGE_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function normalizeMediaType(mt: string): ScanMediaType {
  const lower = mt.toLowerCase();
  if (lower === "application/pdf") return "application/pdf";
  return (IMAGE_TYPES as string[]).includes(lower) ? (lower as ImageMediaType) : "image/jpeg";
}

/**
 * Extract expense fields from base64 evidence. Never throws on model
 * content problems (returns ok:false); does throw on transport / auth
 * errors so callers can log them.
 */
export async function scanExpenseEvidence(opts: {
  apiKey: string;
  data: string;
  mediaType: ScanMediaType;
  /** Israel-local YYYY-MM-DD, used only for plausibility checks. */
  today: string;
}): Promise<ScanOutcome> {
  const anthropic = new Anthropic({ apiKey: opts.apiKey });

  const fileBlock: Anthropic.ContentBlockParam =
    opts.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.data } }
      : { type: "image", source: { type: "base64", media_type: opts.mediaType, data: opts.data } };

  const params = {
    // SCAN_MODEL_OVERRIDE exists only for scripts/_test-scan-compare.mts to A/B
    // models against real receipts; production never sets it.
    model: process.env.SCAN_MODEL_OVERRIDE || SCAN_MODEL,
    max_tokens: 4000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          {
            type: "text",
            text: "Transcribe the evidence, then extract the expense. Leave any field you cannot read with certainty as null. Return the JSON object only.",
          },
        ],
      },
    ],
    // Structured outputs (GA on this model): guarantees the response is a
    // JSON object matching OUTPUT_SCHEMA. Passed as an extra body field
    // because the installed SDK's typings predate the parameter; the API
    // accepts it either way and the prompt also demands JSON, so a stripped
    // field would still degrade gracefully into the parse below.
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;

  const msg = await anthropic.messages.create(params);

  if (msg.stop_reason === "refusal") {
    return { ok: false, reason: "bad_response", message: "לא ניתן לעבד את הקובץ הזה." };
  }

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const parsed = parseJsonObject(text);
  if (!parsed) {
    return { ok: false, reason: "bad_response", message: "תשובת הזיהוי אינה תקינה. נסה שוב.", raw: text };
  }
  return interpretRawScan(parsed, opts.today);
}

/** Tolerant JSON extraction: strips fences and any stray prose around the object. */
function parseJsonObject(text: string): RawScan | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as RawScan;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Turn the model's raw object into ScanFields, applying every guard we can
 * apply without seeing the image. Exported for unit tests.
 */
export function interpretRawScan(raw: RawScan, today: string): ScanOutcome {
  if (raw.error) {
    return { ok: false, reason: "unreadable", message: "לא הצלחתי לקרוא את הקובץ." };
  }
  if (raw.document_kind === "not_an_expense") {
    return { ok: false, reason: "not_expense", message: "הקובץ לא נראה כמו קבלה או אסמכתה לתשלום." };
  }

  const ev = raw.evidence ?? {};
  const vendorLines = Array.isArray(ev.vendor_lines)
    ? ev.vendor_lines.filter((l): l is string => typeof l === "string" && l.trim() !== "")
    : [];
  const totalLine = nonEmptyString(ev.total_line);
  const vatLine = nonEmptyString(ev.vat_line);
  const dateLine = nonEmptyString(ev.date_line);

  // --- vendor: needs transcribed evidence ---------------------------------
  let vendor = nonEmptyString(raw.vendor);
  if (vendor && vendorLines.length === 0) vendor = null;
  if (vendor) vendor = vendor.replace(/\s+/g, " ").trim().slice(0, 120);
  if (vendor && /^(unknown|null|n\/a|לא ידוע|לא זוהה)$/i.test(vendor)) vendor = null;

  // --- amount: needs a total line and must be a sane positive number ------
  let amount = finiteNumber(raw.amount);
  if (amount != null && !totalLine) amount = null;
  if (amount != null && (amount <= 0 || amount > 10_000_000)) amount = null;
  if (amount != null && !numberAppearsIn(amount, totalLine)) amount = null;
  if (amount != null) amount = round2(amount);

  // --- VAT: needs an explicit VAT line, must fit under the total ----------
  let vatAmount = finiteNumber(raw.vatAmount);
  if (vatAmount != null && !vatLine) vatAmount = null;
  if (vatAmount != null && vatAmount <= 0) vatAmount = null;
  if (vatAmount != null && amount != null && vatAmount >= amount) vatAmount = null;
  if (vatAmount != null && !numberAppearsIn(vatAmount, vatLine)) vatAmount = null;
  if (vatAmount != null) vatAmount = round2(vatAmount);

  // --- date: needs a date line, must be a real, plausible calendar date ---
  let date = nonEmptyString(raw.date);
  if (date && !dateLine) date = null;
  if (date && !isPlausibleIsoDate(date, today)) date = null;
  if (date && dateLine && !dateMatchesLine(date, dateLine)) date = null;

  // --- category / description ---------------------------------------------
  const category: ExpenseCategory = (EXPENSE_CATEGORIES as readonly string[]).includes(String(raw.category))
    ? (raw.category as ExpenseCategory)
    : "אחר";
  let description = nonEmptyString(raw.description);
  if (description) description = description.replace(/\s+/g, " ").trim().slice(0, 200);

  const legibility: ScanFields["legibility"] =
    raw.legibility === "good" || raw.legibility === "partial" || raw.legibility === "unreadable"
      ? raw.legibility
      : "partial";

  const unreadFields: string[] = [];
  if (!vendor) unreadFields.push("ספק");
  if (amount == null) unreadFields.push("סכום");
  if (!date) unreadFields.push("תאריך");

  if (legibility === "unreadable" || (!vendor && amount == null && !date)) {
    return {
      ok: false,
      reason: "unreadable",
      message: "לא הצלחתי לקרוא את הקבלה בביטחון. נסה צילום חד יותר בתאורה טובה, או הזן ידנית.",
    };
  }

  return {
    ok: true,
    fields: {
      vendor,
      amount,
      vatAmount,
      date,
      category,
      description,
      unreadFields,
      legibility,
      documentKind: typeof raw.document_kind === "string" ? raw.document_kind : "unknown",
    },
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function finiteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The transcribed line must actually contain the number the model extracted
 * (allowing for thousands separators, ".00" and Hebrew RTL digit order being
 * the same in text). Guards against "total_line: 'סה"כ 120.00', amount: 1200".
 */
function numberAppearsIn(n: number, line: string | null): boolean {
  if (!line) return false;
  return numbersInLine(line).some((v) => Math.abs(v - n) < 0.005);
}

/**
 * Every numeric token in a transcribed line, as numbers. Understands
 * "1,234.50" (thousands comma), "1234,50" (decimal comma), "1.234,50"
 * (European) and plain "120". Exported for tests.
 */
export function numbersInLine(line: string): number[] {
  const out: number[] = [];
  const tokens = line.match(/\d[\d.,]*/g) ?? [];
  for (const raw of tokens) {
    const t = raw.replace(/[.,]+$/, "");
    if (!t) continue;
    const candidates = new Set<string>();
    candidates.add(t.replace(/,/g, "")); // 1,234.50 -> 1234.50 ; 120 -> 120
    if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) candidates.add(t.replace(/\./g, "").replace(",", ".")); // 1.234,50
    if (/^\d+,\d{1,2}$/.test(t)) candidates.add(t.replace(",", ".")); // 1234,50
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) candidates.add(t.replace(/\./g, "")); // 1.234 (thousands dot)
    for (const c of candidates) {
      const v = Number(c);
      if (Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

function isPlausibleIsoDate(iso: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  // Receipts are not dated in the future (allow 1 day of timezone slack).
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 1);
  return dt.getTime() <= limit.getTime();
}

/**
 * The extracted ISO date must be consistent with the digits in the
 * transcribed date line: same day and month numbers must appear, and the
 * year (4-digit or 2-digit) too. Catches day/month swaps the model made
 * against its own transcription and outright invented dates.
 */
function dateMatchesLine(iso: string, line: string): boolean {
  const [y, m, d] = iso.split("-");
  const nums = line.match(/\d+/g) ?? [];
  const has = (s: string) => nums.some((n) => n === s || n === String(Number(s)));
  const yearOk = has(y) || has(y.slice(2));
  const dayOk = has(d);
  const monthOk = has(m) || monthNameIn(line, Number(m));
  return yearOk && dayOk && monthOk;
}

const MONTH_NAMES: Record<number, string[]> = {
  1: ["jan", "ינואר"],
  2: ["feb", "פברואר"],
  3: ["mar", "מרץ", "מרס"],
  4: ["apr", "אפריל"],
  5: ["may", "מאי"],
  6: ["jun", "יוני"],
  7: ["jul", "יולי"],
  8: ["aug", "אוגוסט"],
  9: ["sep", "ספטמבר"],
  10: ["oct", "אוקטובר"],
  11: ["nov", "נובמבר"],
  12: ["dec", "דצמבר"],
};

function monthNameIn(line: string, month: number): boolean {
  const lower = line.toLowerCase();
  return (MONTH_NAMES[month] ?? []).some((name) => lower.includes(name));
}

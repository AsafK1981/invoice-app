import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { checkRate, clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

const RECEIPT_BUCKET = "expense-receipts";

function extForMediaType(mt: string): string {
  if (mt === "image/jpeg") return "jpg";
  if (mt === "image/png") return "png";
  if (mt === "image/webp") return "webp";
  if (mt === "image/gif") return "gif";
  if (mt === "application/pdf") return "pdf";
  return "bin";
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
- date: Date of the expense / payment in YYYY-MM-DD format. Israeli dates are usually DD/MM/YYYY — convert. If unclear, use today's date.
- category: Best guess from this exact Hebrew list:
  "תוכנה" | "ציוד" | "שיווק" | "משרד" | "שירותים מקצועיים" | "נסיעות" | "אחר"
- description: One-line Hebrew description of WHAT the expense was for (e.g. "ארוחת עסקים", "דלק", "מנוי חודשי OpenAI", "תיקון לרכב"). If you can't tell the purpose, describe the source (e.g. "תשלום בביט", "העברה בנקאית").

If the file is unreadable or clearly not evidence of an expense, return:
{"error": "cannot_parse", "reason": "<short Hebrew explanation>"}

Return JSON only. No markdown fences. No commentary. No extra text.`;

const MODEL = "claude-haiku-4-5-20251001";

type ParsedReceipt = {
  vendor: string;
  amount: number;
  vatAmount: number | null;
  date: string;
  category: string;
  description: string;
};

type ScanError = { error: string; reason?: string };

function isError(p: unknown): p is ScanError {
  return typeof p === "object" && p !== null && "error" in p;
}

export async function POST(req: NextRequest) {
  try {
    if (!anthropicKey) {
      return NextResponse.json(
        { ok: false, error: "OCR לא מוגדר במערכת. נדרש מפתח Anthropic." },
        { status: 503 },
      );
    }

    const ip = clientIp(req);
    const ipLimit = checkRate({ key: `expenses-scan:ip:${ip}`, max: 30, windowMs: 60_000 });
    if (!ipLimit.ok) {
      return NextResponse.json(
        { ok: false, error: "יותר מדי בקשות. נסה שוב בעוד דקה." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(ipLimit.resetIn / 1000)) } },
      );
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const userLimit = checkRate({ key: `expenses-scan:user:${user.id}`, max: 60, windowMs: 60 * 60_000 });
    if (!userLimit.ok) {
      return NextResponse.json(
        { ok: false, error: "חרגת ממכסת הסריקה השעתית (60 סריקות לשעה)." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(userLimit.resetIn / 1000)) } },
      );
    }

    const body = await req.json();
    const fileRaw = String(body.image || body.file || "").trim();
    if (!fileRaw) {
      return NextResponse.json({ ok: false, error: "קובץ חסר." }, { status: 400 });
    }

    type ImageMedia = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    type DocMedia = "application/pdf";
    let mediaType: ImageMedia | DocMedia = "image/jpeg";
    let data = fileRaw;
    const dataUrlMatch = fileRaw.match(/^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,(.+)$/i);
    if (dataUrlMatch) {
      mediaType = dataUrlMatch[1].toLowerCase() as ImageMedia | DocMedia;
      data = dataUrlMatch[2];
    }
    const isPdf = mediaType === "application/pdf";

    // PDFs can be larger than photos; allow up to ~15MB of base64 (~11MB
    // original). Images stay at the original ~5MB cap because the model
    // doesn't benefit from larger photos.
    const sizeCap = isPdf ? 20_000_000 : 8_000_000;
    if (data.length > sizeCap) {
      return NextResponse.json(
        { ok: false, error: isPdf ? "ה-PDF גדול מדי (מעל ~12MB)." : "התמונה גדולה מדי (מעל ~5MB)." },
        { status: 413 },
      );
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const today = new Date().toISOString().slice(0, 10);

    const fileBlock = isPdf
      ? ({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data },
        } as const)
      : ({
          type: "image",
          source: { type: "base64", media_type: mediaType as ImageMedia, data },
        } as const);

    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            { type: "text", text: `Today's date is ${today}. Extract the expense and return JSON only.` },
          ],
        },
      ],
    });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: "תשובת ה-OCR אינה תקפה.", raw: text },
        { status: 502 },
      );
    }

    if (isError(parsed)) {
      return NextResponse.json(
        { ok: false, error: parsed.reason || "לא ניתן לקרוא את הקבלה." },
        { status: 422 },
      );
    }

    const r = parsed as Partial<ParsedReceipt>;
    if (!r.vendor || typeof r.amount !== "number") {
      return NextResponse.json(
        { ok: false, error: "תשובת ה-OCR חסרה שדות חובה." },
        { status: 502 },
      );
    }

    // Persist the source file in Storage so the user can revisit it later
    // and double-check the OCR. Path: {user_id}/{uuid}.{ext}. RLS scopes
    // access to the owner via the first folder segment (see migration
    // 20260531-expense-receipts.sql).
    let receiptPath: string | null = null;
    try {
      const ext = extForMediaType(mediaType);
      const fileBytes = Buffer.from(data, "base64");
      const uuid = crypto.randomUUID();
      const path = `${user.id}/${uuid}.${ext}`;
      const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: upErr } = await admin.storage
        .from(RECEIPT_BUCKET)
        .upload(path, fileBytes, { contentType: mediaType, upsert: false });
      if (upErr) {
        console.error("[scan] storage upload failed:", upErr.message);
      } else {
        receiptPath = path;
      }
    } catch (uploadErr) {
      console.error("[scan] storage upload exception:", uploadErr instanceof Error ? uploadErr.message : uploadErr);
    }

    return NextResponse.json({
      ok: true,
      data: {
        vendor: String(r.vendor),
        amount: Number(r.amount),
        vatAmount: typeof r.vatAmount === "number" ? r.vatAmount : null,
        date: String(r.date || today),
        category: String(r.category || "אחר"),
        description: String(r.description || ""),
        receiptPath,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

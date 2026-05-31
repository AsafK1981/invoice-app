import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { checkRate, clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

const SYSTEM = `You are a receipt and invoice OCR system for Israeli small businesses (עוסק פטור / עוסק מורשה).

Given an image of a receipt or invoice (typically in Hebrew), extract these fields and return STRICT JSON only:

{
  "vendor": string,
  "amount": number,
  "vatAmount": number | null,
  "date": string,
  "category": string,
  "description": string
}

Field rules:
- vendor: Business or supplier name. Use the Hebrew name if printed in Hebrew, else English.
- amount: The TOTAL bottom-line amount paid by the buyer, in NIS (₪). Include VAT. Just the number, no currency symbol.
- vatAmount: If the receipt explicitly shows a VAT line (מע"מ / מעמ / VAT), extract that number. Otherwise null.
- date: Date on the receipt in YYYY-MM-DD format. Israeli date formats are usually DD/MM/YYYY — convert. If date is unreadable, use today's date.
- category: Best guess from this exact list (Hebrew strings):
  "תוכנה" | "ציוד" | "שיווק" | "משרד" | "שירותים מקצועיים" | "נסיעות" | "אחר"
- description: One-line Hebrew description of what was purchased (e.g. "ארוחת עסקים", "דלק", "מנוי חודשי תוכנה").

If the image is unreadable or clearly not a receipt, return:
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
    const imageRaw = String(body.image || "").trim();
    if (!imageRaw) {
      return NextResponse.json({ ok: false, error: "תמונה חסרה." }, { status: 400 });
    }

    let mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" = "image/jpeg";
    let data = imageRaw;
    const dataUrlMatch = imageRaw.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i);
    if (dataUrlMatch) {
      mediaType = dataUrlMatch[1].toLowerCase() as typeof mediaType;
      data = dataUrlMatch[2];
    }

    if (data.length > 8_000_000) {
      return NextResponse.json({ ok: false, error: "התמונה גדולה מדי (מעל ~5MB)." }, { status: 413 });
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const today = new Date().toISOString().slice(0, 10);

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
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: `Today's date is ${today}. Parse this receipt and return JSON only.` },
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

    return NextResponse.json({
      ok: true,
      data: {
        vendor: String(r.vendor),
        amount: Number(r.amount),
        vatAmount: typeof r.vatAmount === "number" ? r.vatAmount : null,
        date: String(r.date || today),
        category: String(r.category || "אחר"),
        description: String(r.description || ""),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

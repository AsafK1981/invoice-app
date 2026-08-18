import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scanExpenseEvidence, normalizeMediaType, type ScanMediaType } from "@/lib/expense-scan";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { todayInIsrael } from "@/lib/date";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

const RECEIPT_BUCKET = "expense-receipts";

export const maxDuration = 60;

// The hourly checkRate below only throttles request RATE and is in-memory
// (resets on every cold start) - it doesn't bound total monthly spend on the
// one ANTHROPIC_API_KEY every user's scan draws from, and this feature isn't
// plan-gated. 300/month is generous headroom over measured light/heavy
// legitimate usage (5-50/month) while bounding worst case to ~$0.90/user/month
// instead of the ~$130 a sustained-hourly-limit account could otherwise run up.
const MONTHLY_SCAN_CAP = 300;

function extForMediaType(mt: string): string {
  if (mt === "image/jpeg") return "jpg";
  if (mt === "image/png") return "png";
  if (mt === "image/webp") return "webp";
  if (mt === "image/gif") return "gif";
  if (mt === "application/pdf") return "pdf";
  return "bin";
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

    const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Persistent monthly cap - see MONTHLY_SCAN_CAP above for why the
    // in-memory hourly limit above isn't enough on its own. Checked before
    // touching the file or Anthropic so an over-cap request costs nothing.
    const scanMonth = todayInIsrael().slice(0, 7);
    const { data: monthlyCount, error: monthlyErr } = await admin.rpc("increment_expense_scan_usage", {
      p_user_id: user.id,
      p_month: scanMonth,
    });
    if (monthlyErr) {
      console.error("[scan] monthly usage check failed:", monthlyErr.message);
      // Fail open: don't block scanning over a bug in the cap check itself.
    } else if ((monthlyCount as number) > MONTHLY_SCAN_CAP) {
      return NextResponse.json(
        { ok: false, error: `חרגת ממכסת הסריקה החודשית (${MONTHLY_SCAN_CAP} סריקות לחודש).` },
        { status: 429 },
      );
    }

    const body = await req.json();
    const fileRaw = String(body.image || body.file || "").trim();
    if (!fileRaw) {
      return NextResponse.json({ ok: false, error: "קובץ חסר." }, { status: 400 });
    }

    let mediaType: ScanMediaType = "image/jpeg";
    let data = fileRaw;
    const dataUrlMatch = fileRaw.match(/^data:([a-z0-9.+/-]+);base64,(.+)$/i);
    if (dataUrlMatch) {
      const declared = dataUrlMatch[1].toLowerCase();
      // HEIC/HEIF (iPhone default) and anything else the model can't
      // decode: say so instead of sending bytes labelled as JPEG and
      // failing with a generic error.
      if (!/^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(declared)) {
        return NextResponse.json(
          { ok: false, error: "פורמט הקובץ לא נתמך. שלח JPG / PNG / PDF (בטלפון: צלם מסך של הקבלה או ייצא כ-JPEG)." },
          { status: 415 },
        );
      }
      mediaType = normalizeMediaType(declared);
      data = dataUrlMatch[2];
    }
    const isPdf = mediaType === "application/pdf";

    // PDFs can be larger than photos; allow up to ~15MB of base64 (~11MB
    // original). Images: the client downsizes to the model's max useful
    // resolution before upload, so anything past ~8MB of base64 is a raw
    // upload from an old client or a non-photo - reject rather than pay for it.
    const sizeCap = isPdf ? 20_000_000 : 8_000_000;
    if (data.length > sizeCap) {
      return NextResponse.json(
        { ok: false, error: isPdf ? "ה-PDF גדול מדי (מעל ~12MB)." : "התמונה גדולה מדי (מעל ~5MB)." },
        { status: 413 },
      );
    }

    const today = todayInIsrael();

    // The Storage upload only depends on `data`/`mediaType`, never on the OCR
    // result, so it doesn't need to wait for scanExpenseEvidence to finish -
    // run both concurrently instead of serializing them. `userId` is captured
    // here (rather than reading `user.id` inside the nested function) because
    // TypeScript doesn't carry the `!user` narrowing above into a closure.
    const userId = user.id;
    async function uploadReceipt(): Promise<string | null> {
      try {
        const ext = extForMediaType(mediaType);
        const fileBytes = Buffer.from(data, "base64");
        const uuid = crypto.randomUUID();
        const path = `${userId}/${uuid}.${ext}`;
        const { error: upErr } = await admin.storage
          .from(RECEIPT_BUCKET)
          .upload(path, fileBytes, { contentType: mediaType, upsert: false });
        if (upErr) {
          console.error("[scan] storage upload failed:", upErr.message);
          return null;
        }
        return path;
      } catch (uploadErr) {
        console.error("[scan] storage upload exception:", uploadErr instanceof Error ? uploadErr.message : uploadErr);
        return null;
      }
    }

    const [outcome, receiptPath] = await Promise.all([
      scanExpenseEvidence({ apiKey: anthropicKey, data, mediaType, today }),
      uploadReceipt(),
    ]);

    if (!outcome.ok) {
      // OCR failed after the upload already succeeded - don't leave an
      // orphan object in Storage for a receipt no expense will ever point at.
      if (receiptPath) {
        const { error: removeErr } = await admin.storage.from(RECEIPT_BUCKET).remove([receiptPath]);
        if (removeErr) {
          console.error("[scan] cleanup of orphaned upload failed:", removeErr.message);
        }
      }
      if (outcome.reason === "bad_response") {
        console.error("[scan] unparseable model output:", (outcome.raw || "").slice(0, 300));
        return NextResponse.json({ ok: false, error: outcome.message }, { status: 502 });
      }
      return NextResponse.json({ ok: false, error: outcome.message }, { status: 422 });
    }
    const r = outcome.fields;

    // Every field may be null: the model was told to leave anything it
    // could not read with certainty blank, and interpretRawScan nulls out
    // values that lack transcribed evidence or fail sanity checks. The form
    // shows the user which fields to fill by hand (unreadFields).
    return NextResponse.json({
      ok: true,
      data: {
        vendor: r.vendor,
        amount: r.amount,
        vatAmount: r.vatAmount,
        date: r.date,
        category: r.category,
        description: r.description,
        unreadFields: r.unreadFields,
        legibility: r.legibility,
        receiptPath,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    // Log the real error (Anthropic SDK errors include the raw JSON body,
    // e.g. account-level "credit balance too low") but never forward it to
    // the client: it's in English, exposes API internals, and reads as
    // broken/untrustworthy in a Hebrew UI. Same undebuggable-until-logged
    // gap as /api/dashboard/insights had.
    console.error("expenses/scan failed:", msg);
    return NextResponse.json(
      { ok: false, error: "סריקת הקבלה נכשלה. נסה שוב, או הזן את הפרטים ידנית." },
      { status: 500 },
    );
  }
}

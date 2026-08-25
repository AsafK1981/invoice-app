import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractBrandKit, normalizeBrandMediaType, type BrandFile } from "@/lib/brand-extract";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { todayInIsrael } from "@/lib/date";

// POST /api/design/brand-import
// Body: { files: [{ data: <data URL> }, ...] }  (1-3 files: PDF and/or images)
// Returns the validated BrandKit; the client maps it onto the design draft
// (src/lib/brand-kit.ts) and the user still has to press "שמור עיצוב".
//
// Paid call (Anthropic). Guarded like /api/expenses/scan: Bearer auth,
// per-IP and per-user in-memory rate limits, and a persistent monthly cap
// that reuses the scanner's usage counter under a namespaced month key
// ("brand:YYYY-MM") - no new table, no migration.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

export const maxDuration = 60;

// A brand import is a one-off per business; 12/month is plenty of retries
// and bounds the worst case at well under a shekel per user per month.
const MONTHLY_BRAND_IMPORT_CAP = 12;
const MAX_FILES = 3;
// Vercel caps the request body at ~4.5MB; the client keeps the payload
// under this and says so to the user before sending.
const MAX_TOTAL_BASE64 = 4_400_000;

export async function POST(req: NextRequest) {
  try {
    if (!anthropicKey) {
      return NextResponse.json({ ok: false, error: "ייבוא קובץ מיתוג לא מוגדר במערכת. נדרש מפתח Anthropic." }, { status: 503 });
    }

    const ip = clientIp(req);
    const ipLimit = checkRate({ key: `brand-import:ip:${ip}`, max: 10, windowMs: 60_000 });
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

    const userLimit = checkRate({ key: `brand-import:user:${user.id}`, max: 6, windowMs: 60 * 60_000 });
    if (!userLimit.ok) {
      return NextResponse.json(
        { ok: false, error: "חרגת ממכסת הייבוא השעתית (6 ייבואים לשעה)." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(userLimit.resetIn / 1000)) } },
      );
    }

    const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const month = `brand:${todayInIsrael().slice(0, 7)}`;
    const { data: monthlyCount, error: monthlyErr } = await admin.rpc("increment_expense_scan_usage", {
      p_user_id: user.id,
      p_month: month,
    });
    if (monthlyErr) {
      console.error("[brand-import] monthly usage check failed:", monthlyErr.message);
      // Fail open, like the scanner: a bug in the counter must not block the feature.
    } else if ((monthlyCount as number) > MONTHLY_BRAND_IMPORT_CAP) {
      return NextResponse.json(
        { ok: false, error: `חרגת ממכסת ייבוא קובצי המיתוג החודשית (${MONTHLY_BRAND_IMPORT_CAP} לחודש).` },
        { status: 429 },
      );
    }

    const body = await req.json().catch(() => null);
    const rawFiles = Array.isArray(body?.files) ? body.files : [];
    if (rawFiles.length === 0) {
      return NextResponse.json({ ok: false, error: "קובץ חסר." }, { status: 400 });
    }
    if (rawFiles.length > MAX_FILES) {
      return NextResponse.json({ ok: false, error: `עד ${MAX_FILES} קבצים בייבוא אחד.` }, { status: 400 });
    }

    const files: BrandFile[] = [];
    let total = 0;
    for (const f of rawFiles) {
      const raw = String(f?.data || "").trim();
      const m = raw.match(/^data:([a-z0-9.+/-]+);base64,(.+)$/i);
      if (!m) {
        return NextResponse.json({ ok: false, error: "פורמט קובץ לא תקין." }, { status: 400 });
      }
      const mediaType = normalizeBrandMediaType(m[1]);
      if (!mediaType) {
        return NextResponse.json(
          { ok: false, error: "פורמט לא נתמך לניתוח. השתמש ב-PDF, PNG, JPG או WebP (לוגו SVG אפשר להעלות, אבל לא לנתח)." },
          { status: 415 },
        );
      }
      total += m[2].length;
      if (total > MAX_TOTAL_BASE64) {
        return NextResponse.json({ ok: false, error: "הקבצים גדולים מדי (עד 3MB יחד)." }, { status: 413 });
      }
      files.push({ data: m[2], mediaType });
    }

    const outcome = await extractBrandKit({ apiKey: anthropicKey, files });
    if (!outcome.ok) {
      if (outcome.raw) console.error("[brand-import] unparseable model output:", outcome.raw.slice(0, 300));
      return NextResponse.json({ ok: false, error: outcome.message }, { status: 422 });
    }

    return NextResponse.json({ ok: true, kit: outcome.kit, usage: { count: monthlyCount ?? null, cap: MONTHLY_BRAND_IMPORT_CAP } });
  } catch (err) {
    console.error("[brand-import] failed:", err);
    return NextResponse.json({ ok: false, error: "ייבוא קובץ המיתוג נכשל. נסה שוב." }, { status: 500 });
  }
}

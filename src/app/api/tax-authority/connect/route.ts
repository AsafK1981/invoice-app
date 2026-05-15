import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { buildAuthorizeUrl, isTaxAuthorityConfigured } from "@/lib/tax-authority";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Initiate the gov.il OAuth handshake for the calling business.
 * Returns a JSON { url } the client navigates to. Stores a one-time
 * state token in tax_authority_oauth_states; the /callback route
 * verifies it before exchanging the code for tokens.
 */
export async function POST(req: NextRequest) {
  if (!isTaxAuthorityConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "האפליקציה עדיין לא רשומה כבית-תוכנה ברשות המיסים. נדרשים TAX_AUTHORITY_CLIENT_ID, _CLIENT_SECRET ו-_SOFTWARE_NUMBER ב-Vercel env.",
      },
      { status: 503 },
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

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve caller's primary business
  const { data: businesses } = await sb
    .from("businesses")
    .select("id, business_type")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  const biz = businesses?.[0];
  if (!biz) {
    return NextResponse.json(
      { ok: false, error: "אין עסק. השלם את ה-onboarding קודם." },
      { status: 400 },
    );
  }
  if (biz.business_type !== "licensed") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "חיבור ל-חשבונית ישראל זמין רק לעוסק מורשה. עדכן את סוג העסק בהגדרות אם רלוונטי.",
      },
      { status: 400 },
    );
  }

  const state = randomBytes(24).toString("hex");
  const { error: stateErr } = await sb.from("tax_authority_oauth_states").insert({
    state,
    business_id: biz.id,
    user_id: user.id,
  });
  if (stateErr) {
    return NextResponse.json({ ok: false, error: "שגיאה ביצירת state" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: buildAuthorizeUrl(state) });
}

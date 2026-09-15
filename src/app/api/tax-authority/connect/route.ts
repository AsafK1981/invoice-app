import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildAuthorizeUrl, isTaxAuthorityConfigured } from "@/lib/tax-authority";
import { newOAuthNonce } from "@/lib/oauth-browser-binding";
import {
  TAX_AUTHORITY_OAUTH_NONCE_COOKIE,
  taxAuthorityNonceCookieOptions,
  taxAuthorityStateFromNonce,
} from "@/lib/tax-authority-oauth";
import { canIssueTaxInvoicesByType } from "@/lib/vat";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Initiate the gov.il OAuth handshake for the calling business.
 * Returns a JSON { url } the client navigates to. Stores a one-time
 * state token in tax_authority_oauth_states; the /callback route
 * verifies it before exchanging the code for tokens.
 *
 * The state is derived from a random nonce that goes into an HttpOnly
 * cookie on this very response (a same-origin fetch, so the browser stores
 * it before it navigates to gov.il). The callback only proceeds when the
 * browser brings that cookie back, which binds the attempt to the browser
 * that started it. See src/lib/tax-authority-oauth.ts.
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
  // Allocation numbers apply to VAT-charging businesses: עוסק מורשה
  // ("authorized") and חברה ("company"). The DB never stores "licensed".
  if (!canIssueTaxInvoicesByType(biz.business_type)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "חיבור לחשבונית ישראל זמין רק לעוסק מורשה / חברה. עדכן את סוג העסק בהגדרות אם רלוונטי.",
      },
      { status: 400 },
    );
  }

  const nonce = newOAuthNonce();
  const state = taxAuthorityStateFromNonce(nonce);
  const { error: stateErr } = await sb.from("tax_authority_oauth_states").insert({
    state,
    business_id: biz.id,
    user_id: user.id,
  });
  if (stateErr) {
    return NextResponse.json({ ok: false, error: "שגיאה ביצירת state" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true, url: buildAuthorizeUrl(state) });
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(TAX_AUTHORITY_OAUTH_NONCE_COOKIE, nonce, taxAuthorityNonceCookieOptions());
  return res;
}

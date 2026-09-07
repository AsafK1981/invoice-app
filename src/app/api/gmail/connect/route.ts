// Start and end a Gmail connection for הוצאות מהמייל.
//
// POST   -> { ok, url }   the Google consent URL to send the browser to
// DELETE -> { ok }        revoke the grant (best effort) and forget the account
//
// Both are Bearer-authenticated and act on the caller's own business only.
// The client secret never leaves the server; the browser only ever sees the
// consent URL and, later, "מחובר ל-<email>".

import { NextRequest, NextResponse } from "next/server";
import { checkRate } from "@/lib/rate-limit";
import { resolveInboxCaller } from "@/lib/email-inbox-server";
import { decryptColumnOrNull } from "@/lib/crypto";
import {
  GMAIL_CALLBACK_PATH,
  OAUTH_STATE_TTL_MS,
  buildGoogleAuthUrl,
  getGmailAccount,
  revokeToken,
  signOAuthState,
} from "@/lib/gmail-connect";
import { requestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const caller = await resolveInboxCaller(req);
  if (!caller.ok) return caller.response;
  const { business, userId } = caller;

  const rl = checkRate({ key: `gmail-connect:${userId}`, max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "יותר מדי בקשות. נסה שוב בעוד דקה." }, { status: 429 });
  }

  const secret = process.env.COLUMN_ENCRYPTION_KEY;
  if (!process.env.GOOGLE_OAUTH_CLIENT_SECRET || !secret) {
    // Fail closed and say so: a consent URL that can never be completed is worse than no button.
    return NextResponse.json({ ok: false, error: "החיבור ל-Gmail עוד לא הופעל בשרת." }, { status: 503 });
  }

  const state = signOAuthState({ businessId: business.id, userId, exp: Date.now() + OAUTH_STATE_TTL_MS }, secret);
  const url = buildGoogleAuthUrl(`${requestOrigin(req)}${GMAIL_CALLBACK_PATH}`, state);
  return NextResponse.json({ ok: true, url });
}

export async function DELETE(req: NextRequest) {
  const caller = await resolveInboxCaller(req);
  if (!caller.ok) return caller.response;
  const { admin, business, userId } = caller;

  const rl = checkRate({ key: `gmail-connect:${userId}`, max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "יותר מדי בקשות. נסה שוב בעוד דקה." }, { status: 429 });
  }

  const account = await getGmailAccount(admin, business.id);
  if (account) {
    const token = decryptColumnOrNull(account.refresh_token_enc);
    if (token) await revokeToken(token);
    const { error } = await admin.from("email_accounts").delete().eq("id", account.id).eq("business_id", business.id);
    if (error) {
      console.error("[gmail-connect] delete failed:", error.message);
      return NextResponse.json({ ok: false, error: "הניתוק נכשל." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}

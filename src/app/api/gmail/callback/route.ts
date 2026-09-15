// Google sends the user back here after the consent screen.
//
// GET ?code=&state=   -> redirect to /expenses?gmail=connected#email-inbox
// GET ?error=...      -> redirect to /expenses?gmail=error#email-inbox
// nonce cookie absent or not matching the state
//                     -> redirect to /expenses?gmail=browser#email-inbox
//
// No app session is available on this hop (Google redirects a bare browser).
// Two things together authorise it: the signed `state` names the business and
// user who pressed "חבר" less than ten minutes ago, and the HttpOnly nonce
// cookie that /api/gmail/connect set proves this is the same browser that
// pressed it. Without the cookie check a consent link could be completed by a
// different person, attaching their mailbox to the business that started it.
// The cookie is cleared on every outcome. Nothing about the failure is put in
// the URL beyond the outcome word; details go to the server log.

import { NextRequest, NextResponse } from "next/server";
import { cronAdminClient } from "@/lib/cron";
import {
  GMAIL_CALLBACK_PATH,
  GMAIL_OAUTH_NONCE_COOKIE,
  GMAIL_SCOPES,
  emailFromIdToken,
  exchangeCodeForTokens,
  getGmailAccount,
  gmailNonceCookieOptions,
  oauthNonceMatches,
  saveGmailAccount,
  verifyOAuthState,
} from "@/lib/gmail-connect";
import { requestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const back = (outcome: "connected" | "error" | "browser") => {
    const res = NextResponse.redirect(`${origin}/expenses?gmail=${outcome}#email-inbox`, { status: 302 });
    // One attempt, one nonce: clear it whatever happened. Same name, path and
    // attributes as when it was set, or the browser keeps the old one.
    res.cookies.set(GMAIL_OAUTH_NONCE_COOKIE, "", gmailNonceCookieOptions(0));
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code) return back("error");

  const secret = process.env.COLUMN_ENCRYPTION_KEY;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!secret || !clientSecret) {
    console.error("[gmail-connect] callback without server configuration");
    return back("error");
  }

  const state = verifyOAuthState(stateParam, secret);
  if (!state) {
    console.warn("[gmail-connect] callback with invalid or expired state");
    return back("error");
  }

  // Same browser that pressed "חבר"? Checked before the code is exchanged, so
  // a consent completed elsewhere never yields tokens, let alone a saved row.
  if (!oauthNonceMatches(req.cookies.get(GMAIL_OAUTH_NONCE_COOKIE)?.value, state.nonceHash)) {
    console.warn("[gmail-connect] callback without the matching browser nonce");
    return back("browser");
  }

  const admin = cronAdminClient();
  // The state says which business; the database confirms it is still that
  // user's business before anything is written under it.
  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select("id")
    .eq("id", state.businessId)
    .eq("user_id", state.userId)
    .maybeSingle();
  if (bizErr || !biz) {
    console.warn("[gmail-connect] callback for a business the state's user does not own");
    return back("error");
  }

  const tokens = await exchangeCodeForTokens(code, `${origin}${GMAIL_CALLBACK_PATH}`, clientSecret);
  if (!tokens) return back("error");

  const grantedScope = tokens.scope ?? "";
  if (!grantedScope.includes("gmail.readonly")) {
    // The user unticked the mailbox permission on the consent screen. Without
    // it there is nothing to import, so this is not a connection.
    console.warn("[gmail-connect] consent given without gmail.readonly");
    return back("error");
  }

  const email = emailFromIdToken(tokens.id_token);
  if (!email) return back("error");

  let refreshToken = tokens.refresh_token ?? null;
  if (!refreshToken) {
    // prompt=consent should always yield one; if Google did not, keep a
    // previously stored token for the same account rather than losing it.
    const existing = await getGmailAccount(admin, state.businessId);
    if (!existing || existing.email !== email) return back("error");
    return back("connected");
  }
  refreshToken = refreshToken.trim();

  const saved = await saveGmailAccount(admin, state.businessId, email, refreshToken, grantedScope || GMAIL_SCOPES.join(" "));
  return back(saved ? "connected" : "error");
}

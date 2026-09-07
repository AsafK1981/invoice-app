// Google sends the user back here after the consent screen.
//
// GET ?code=&state=   -> redirect to /expenses?gmail=connected#email-inbox
// GET ?error=...      -> redirect to /expenses?gmail=error#email-inbox
//
// No session is available on this hop (Google redirects a bare browser), so
// the signed `state` is the whole authorisation: it names the business and
// user who pressed "חבר" less than ten minutes ago. Nothing about the failure
// is put in the URL beyond "error"; details go to the server log.

import { NextRequest, NextResponse } from "next/server";
import { cronAdminClient } from "@/lib/cron";
import {
  GMAIL_CALLBACK_PATH,
  GMAIL_SCOPES,
  emailFromIdToken,
  exchangeCodeForTokens,
  getGmailAccount,
  saveGmailAccount,
  verifyOAuthState,
} from "@/lib/gmail-connect";
import { requestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const back = (outcome: "connected" | "error") =>
    NextResponse.redirect(`${origin}/expenses?gmail=${outcome}#email-inbox`, { status: 302 });

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

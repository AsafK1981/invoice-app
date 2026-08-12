import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { emitSecurityEvent } from "@/lib/security-events";
import { clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// The raw-nonce cookie is single-use; clear it on EVERY exit path (success
// and failure alike) with the same attributes it was set with - SameSite=None
// is what let it survive Google's cross-site POST in the first place.
const NONCE_CLEAR = "g_oidc_nonce=; Path=/; Max-Age=0; Secure; SameSite=None";

/**
 * Google Identity Services redirect-mode callback (ux_mode: "redirect").
 *
 * The GIS popup flow broke on mobile browsers: the popup/new-tab opened by
 * the sign-in button could not hand the credential back to the opener tab
 * (Safari ITP, in-app browsers), so users picked their account and then
 * nothing happened - the id_token never reached Supabase. In redirect mode
 * Google full-page-navigates and POSTs the credential HERE, on our own
 * origin - no popups, no cross-tab messaging, no third-party cookies -
 * which works on every mobile browser and keeps friendlyinvoice.co.il (not
 * supabase.co) in the consent screen.
 *
 * Flow:
 *   1. Verify Google's double-submit CSRF token (g_csrf_token cookie ==
 *      g_csrf_token form field - both are set by GIS itself). A mismatch is
 *      a possible login-CSRF attempt and emits a security event, matching
 *      the tax-authority OAuth callback's convention.
 *   2. Exchange the ID token with Supabase (signInWithIdToken + the raw
 *      nonce the login page stored in a short-lived cookie; Google got the
 *      SHA-256 of it, binding the token to this browser).
 *   3. Hand the session to the client via SHORT-LIVED COOKIES scoped to
 *      /auth/google-complete (2 minutes, Secure, SameSite=Lax), then 303 to
 *      that page, which consumes + deletes them and calls setSession.
 *      Council review (2026-08-12) rejected the earlier URL-fragment
 *      handoff: a fragment is attacker-craftable (login-CSRF - mail the
 *      victim a link carrying the attacker's session) and exposes the
 *      refresh token to anything that can read the URL (Sentry replay,
 *      extensions, header logging). Cookies can't be planted cross-site
 *      and never appear in any URL.
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  const fail = (reason: string) => {
    const res = NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(reason)}`,
      303,
    );
    res.headers.append("Set-Cookie", NONCE_CLEAR);
    return res;
  };

  let credential: FormDataEntryValue | null = null;
  let csrfBody: FormDataEntryValue | null = null;
  try {
    const form = await req.formData();
    credential = form.get("credential");
    csrfBody = form.get("g_csrf_token");
  } catch {
    return fail("google_bad_request");
  }

  if (typeof credential !== "string" || credential.length === 0) {
    return fail("google_missing_credential");
  }

  // Google's documented login-CSRF defense for redirect mode: the value in
  // the POST body must match the cookie GIS set on our domain. Without this
  // an attacker could auto-submit their own credential into a victim's
  // browser and silently log the victim into the attacker's account.
  const csrfCookie = req.cookies.get("g_csrf_token")?.value;
  if (typeof csrfBody !== "string" || !csrfCookie || csrfBody !== csrfCookie) {
    emitSecurityEvent({
      kind: "google_login_csrf",
      ip: clientIp(req),
      message:
        "Google redirect callback with missing/mismatched g_csrf_token: possible login-CSRF or replay",
      severity: "warning",
    });
    return fail("google_csrf");
  }

  // The raw nonce lives in a cookie only this browser has; the ID token
  // carries its SHA-256. If the cookie is gone (expired / blocked / a
  // second login tab overwrote it), the exchange below would be rejected
  // anyway - send the user back for one more tap with a fresh nonce
  // instead of a cryptic failure.
  const nonce = req.cookies.get("g_oidc_nonce")?.value;
  if (!nonce) {
    return fail("google_retry");
  }

  const sb = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb.auth.signInWithIdToken({
    provider: "google",
    token: credential,
    nonce,
  });
  if (error || !data.session) {
    console.error("Google redirect exchange failed:", error?.message);
    return fail("google_exchange");
  }

  const res = NextResponse.redirect(`${origin}/auth/google-complete`, 303);
  res.headers.append("Set-Cookie", NONCE_CLEAR);
  // Not HttpOnly on purpose: the completion page's JS must read these to
  // hand them to supabase-js (which keeps its session in localStorage).
  // Tight Path scope means no other page on the site ever sees them, and
  // Max-Age=120 bounds the exposure to the hydration window.
  const handoff = "Path=/auth/google-complete; Max-Age=120; Secure; SameSite=Lax";
  res.headers.append(
    "Set-Cookie",
    `g_auth_at=${encodeURIComponent(data.session.access_token)}; ${handoff}`,
  );
  res.headers.append(
    "Set-Cookie",
    `g_auth_rt=${encodeURIComponent(data.session.refresh_token)}; ${handoff}`,
  );
  return res;
}

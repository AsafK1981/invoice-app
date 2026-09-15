import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exchangeCodeForTokens, taxAuthorityCallbackOrigin, taxAuthorityEnv } from "@/lib/tax-authority";
import { encryptColumn } from "@/lib/crypto";
import { emitSecurityEvent } from "@/lib/security-events";
import { clientIp } from "@/lib/rate-limit";
import { requestOrigin } from "@/lib/request-origin";
import { CANONICAL_HOST, CANONICAL_ORIGIN } from "@/lib/public-url";
import {
  TAX_AUTHORITY_OAUTH_NONCE_COOKIE,
  isTaxAuthorityStateShape,
  taxAuthorityNonceCookieOptions,
  taxAuthorityNonceMatchesState,
} from "@/lib/tax-authority-oauth";
import type { TaxAuthorityConnectErrorCode } from "@/lib/tax-authority-connect-errors";

// The token exchange goes through the Israeli egress proxy (Cloud Run
// me-west1); allow headroom for proxy cold-start + the gov.il round trip.
export const maxDuration = 30;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d{2,5})?$/;

/**
 * gov.il redirects here with ?code=&state= after the user consents.
 * We:
 *   1. Check the browser binding: the HttpOnly nonce cookie set by /connect
 *      must derive exactly this `state` (the browser that finishes is the
 *      browser that started). Nothing is read, written or exchanged first.
 *   2. Consume the one-time state row atomically (delete ... returning), so
 *      a state works once even under concurrent callbacks, and reject it if
 *      it is unknown, expired, or its business no longer belongs to its user
 *   3. Exchange the code for an access+refresh token pair
 *   4. Store the tokens encrypted-at-rest in tax_authority_credentials, and
 *      only report success when that write succeeded
 *   5. Redirect to /settings with `connected`, or with a short error code
 *
 * The URL only ever carries a code from lib/tax-authority-connect-errors.ts;
 * details go to the server log. The nonce cookie is cleared on every outcome.
 *
 * The tokens never touch the client browser; they live only in our
 * service-role-scoped DB and are pulled server-side when issuing an
 * allocation request.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = requestOrigin(req);
  const here = new URL(origin).host;

  // The registered redirect_uri is on the legacy host, but the nonce cookie
  // was set on the canonical host where the settings page lives. next.config
  // already 308s the legacy host to the canonical one; repeat that hop here so
  // the binding keeps working even if that redirect rule changes. Nothing is
  // consumed on this hop.
  const callbackHost = new URL(taxAuthorityCallbackOrigin()).host;
  if (here === callbackHost && here !== CANONICAL_HOST && !LOCAL_HOST.test(here)) {
    const res = NextResponse.redirect(`${CANONICAL_ORIGIN}${url.pathname}${url.search}`, { status: 307 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  }

  const finish = (outcome: { connected: true } | { error: TaxAuthorityConnectErrorCode }) => {
    const target =
      "connected" in outcome
        ? `${origin}/settings?tax_authority=connected`
        : `${origin}/settings?tax_authority=error&reason=${outcome.error}`;
    const res = NextResponse.redirect(target, { status: 302 });
    // One attempt, one nonce: clear it whatever happened. Same name, path and
    // attributes as when it was set, or the browser keeps the old one.
    res.cookies.set(TAX_AUTHORITY_OAUTH_NONCE_COOKIE, "", taxAuthorityNonceCookieOptions(0));
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  if (providerError) {
    console.warn("[tax-authority] consent returned an error:", providerError.slice(0, 200));
    return finish({ error: providerError === "access_denied" ? "denied" : "provider_error" });
  }
  if (!code || !state) {
    return finish({ error: "missing_params" });
  }
  if (!isTaxAuthorityStateShape(state)) {
    return finish({ error: "invalid_state" });
  }

  // Same browser that pressed "חבר"? Checked before the state row is touched
  // or the code is exchanged, so a consent completed elsewhere never yields
  // tokens, let alone a saved row.
  if (!taxAuthorityNonceMatchesState(req.cookies.get(TAX_AUTHORITY_OAUTH_NONCE_COOKIE)?.value, state)) {
    await emitSecurityEvent({
      kind: "tax_authority_unauthorized",
      ip: clientIp(req),
      message: "OAuth callback without the matching browser nonce cookie",
      severity: "warning",
    });
    return finish({ error: "browser_mismatch" });
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Consume the state row in one statement (DELETE ... RETURNING): only one
  // request can ever get the row back. Doing it before the expiry check means
  // expired/abandoned rows also get cleaned here (there's no separate GC).
  const { data: stateRow, error: stateErr } = await sb
    .from("tax_authority_oauth_states")
    .delete()
    .eq("state", state)
    .select("business_id, user_id, expires_at")
    .maybeSingle();

  if (stateErr) {
    console.error("[tax-authority] consuming OAuth state failed:", stateErr.message);
    return finish({ error: "server_error" });
  }
  if (!stateRow) {
    await emitSecurityEvent({
      kind: "tax_authority_unauthorized",
      ip: clientIp(req),
      message: "OAuth callback with invalid/unknown/used state: possible CSRF or replay",
      severity: "warning",
    });
    return finish({ error: "invalid_state" });
  }

  if (new Date(stateRow.expires_at as string).getTime() < Date.now()) {
    return finish({ error: "expired_state" });
  }

  // The row names the business and user; confirm it is still that user's
  // business before anything is written under it.
  const { data: biz, error: bizErr } = await sb
    .from("businesses")
    .select("id")
    .eq("id", stateRow.business_id)
    .eq("user_id", stateRow.user_id)
    .maybeSingle();
  if (bizErr) {
    console.error("[tax-authority] business lookup failed:", bizErr.message);
    return finish({ error: "server_error" });
  }
  if (!biz) {
    return finish({ error: "invalid_state" });
  }

  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    console.error("Tax Authority callback: token exchange failed:", err);
    return finish({ error: "exchange_failed" });
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  try {
    const { error: saveErr } = await sb
      .from("tax_authority_credentials")
      .upsert(
        {
          business_id: stateRow.business_id,
          vat_number: tokens.vat_number || "",
          access_token: encryptColumn(tokens.access_token),
          refresh_token: encryptColumn(tokens.refresh_token),
          expires_at: expiresAt,
          environment: taxAuthorityEnv(),
          connected_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "business_id" },
      );
    if (saveErr) {
      console.error("[tax-authority] saving credentials failed:", saveErr.message);
      return finish({ error: "save_failed" });
    }
  } catch (err) {
    console.error("[tax-authority] saving credentials threw:", err);
    return finish({ error: "save_failed" });
  }

  return finish({ connected: true });
}

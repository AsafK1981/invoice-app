import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exchangeCodeForTokens, taxAuthorityEnv } from "@/lib/tax-authority";
import { encryptColumn } from "@/lib/crypto";
import { emitSecurityEvent } from "@/lib/security-events";
import { clientIp } from "@/lib/rate-limit";

// The token exchange goes through the Israeli egress proxy (Cloud Run
// me-west1); allow headroom for proxy cold-start + the gov.il round trip.
export const maxDuration = 30;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * gov.il redirects here with ?code=&state= after the user consents.
 * We:
 *   1. Verify `state` (CSRF + cross-account redirect forgery defense)
 *   2. Exchange the code for an access+refresh token pair
 *   3. Store the tokens encrypted-at-rest in tax_authority_credentials
 *   4. Redirect the user back to /settings with a success flag
 *
 * The tokens never touch the client browser; they live only in our
 * service-role-scoped DB and are pulled server-side when issuing an
 * allocation request.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const origin = `${url.protocol}//${url.host}`;

  if (error) {
    return NextResponse.redirect(
      `${origin}/settings?tax_authority=error&reason=${encodeURIComponent(error)}`,
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(`${origin}/settings?tax_authority=error&reason=missing_params`);
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Look up + consume the state row (one-time use)
  const { data: stateRow } = await sb
    .from("tax_authority_oauth_states")
    .select("business_id, user_id, expires_at")
    .eq("state", state)
    .maybeSingle();

  if (!stateRow) {
    await emitSecurityEvent({
      kind: "tax_authority_unauthorized",
      ip: clientIp(req),
      message: "OAuth callback with invalid/unknown state: possible CSRF or replay",
      severity: "warning",
    });
    return NextResponse.redirect(`${origin}/settings?tax_authority=error&reason=invalid_state`);
  }
  // Consume the state up front; one-time use. Doing it before the expiry
  // check means expired/abandoned rows also get cleaned here instead of
  // piling up (there's no separate GC for this table).
  await sb.from("tax_authority_oauth_states").delete().eq("state", state);

  if (new Date(stateRow.expires_at as string).getTime() < Date.now()) {
    return NextResponse.redirect(`${origin}/settings?tax_authority=error&reason=expired_state`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await sb
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

    return NextResponse.redirect(`${origin}/settings?tax_authority=connected`);
  } catch (err) {
    console.error("Tax Authority callback failed:", err);
    return NextResponse.redirect(
      `${origin}/settings?tax_authority=error&reason=${encodeURIComponent(
        err instanceof Error ? err.message : "exchange_failed",
      )}`,
    );
  }
}

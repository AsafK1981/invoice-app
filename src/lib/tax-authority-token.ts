/**
 * Getting a usable רשות המסים access token for a business.
 *
 * The allocation route (api/tax-authority/request-allocation) has an older
 * inline copy of this logic which returns NextResponse objects, so it cannot
 * be called from anywhere that is not an HTTP handler. Rather than refactor a
 * route that works and is on the critical path for issuing invoices, this is a
 * plain function that reports a reason instead of a response, for the newer
 * callers - currently the מבנה אחיד transmission. Worth collapsing the two the
 * next time that route is touched for its own reasons.
 *
 * The refresh token ROTATES on every refresh: שע"ם returns a new one and
 * invalidates the old. Failing to write the new pair back would break the
 * connection permanently on the next call, so the save-back here is not
 * optional bookkeeping.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptColumn, encryptColumn } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/tax-authority";

/** Refresh this far ahead of expiry, so a slow upload cannot outlive its token. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type TokenFailure =
  /** The business never connected its gov.il account. */
  | "not_connected"
  /** Stored blob unreadable: wrong COLUMN_ENCRYPTION_KEY, corruption, tampering. */
  | "decrypt_failed"
  /** שע"ם refused the refresh - usually a revoked or expired grant. */
  | "refresh_failed";

export type TokenResult =
  | { ok: true; accessToken: string; environment: string }
  | { ok: false; reason: TokenFailure; detail?: string };

/** Hebrew for the UI; the caller decides whether to show it. */
export function tokenFailureMessage(reason: TokenFailure): string {
  switch (reason) {
    case "not_connected":
      return "העסק לא מחובר לרשות המסים. אפשר לחבר בהגדרות.";
    case "decrypt_failed":
      return "אירעה שגיאה בקריאת ההרשאות. יש לחבר מחדש בהגדרות.";
    case "refresh_failed":
      return "פג תוקף החיבור לרשות המסים. יש לחבר מחדש בהגדרות.";
  }
}

export async function getValidAccessToken(
  sb: SupabaseClient,
  businessId: string,
): Promise<TokenResult> {
  const { data: creds } = await sb
    .from("tax_authority_credentials")
    .select("access_token, refresh_token, expires_at, environment")
    .eq("business_id", businessId)
    .maybeSingle();

  if (!creds) return { ok: false, reason: "not_connected" };

  const environment = (creds.environment as string) || "sandbox";

  let accessToken: string;
  try {
    accessToken = decryptColumn(creds.access_token as string);
  } catch (err) {
    return {
      ok: false,
      reason: "decrypt_failed",
      detail: err instanceof Error ? err.message : "unknown",
    };
  }

  const expiresAtMs = new Date(creds.expires_at as string).getTime();
  if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() >= REFRESH_MARGIN_MS) {
    return { ok: true, accessToken, environment };
  }

  try {
    const refreshToken = decryptColumn(creds.refresh_token as string);
    const fresh = await refreshAccessToken(refreshToken);
    // Save the rotated pair before returning: if the caller dies mid-upload,
    // the stored tokens are still the valid ones.
    await sb
      .from("tax_authority_credentials")
      .update({
        access_token: encryptColumn(fresh.access_token),
        refresh_token: encryptColumn(fresh.refresh_token),
        expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
      })
      .eq("business_id", businessId);
    return { ok: true, accessToken: fresh.access_token, environment };
  } catch (err) {
    // Only a generic marker is persisted; an upstream gov.il body never
    // reaches the database.
    await sb
      .from("tax_authority_credentials")
      .update({ last_error: "token refresh failed" })
      .eq("business_id", businessId);
    return {
      ok: false,
      reason: "refresh_failed",
      detail: err instanceof Error ? err.message : "unknown",
    };
  }
}

// Tax Authority (חשבונית ישראל) OAuth: browser binding for the connect flow.
// Server only (node:crypto).
//
// The `state` we hand to gov.il is derived from a per-attempt nonce: it is the
// first 48 hex characters (192 bits) of sha256(nonce). That keeps the state
// the same shape it always had (48 lowercase hex characters, stored as the
// primary key of tax_authority_oauth_states), while the nonce itself only ever
// lives in an HttpOnly cookie on the browser that pressed "חבר". The callback
// recomputes the hash from the cookie and compares it to the returned state in
// constant time before it consumes the state row or exchanges the code.
//
// Hosts: the redirect_uri registered with שע"מ is on the legacy vercel.app
// host, which 308-redirects every path (query included) to the canonical
// domain, where the settings page that calls connect also lives. So the
// cookie is set and read on the same host. The callback route also performs
// that hop itself, in case the config-level redirect ever stops covering it.

import { constantTimeEqual, hashOAuthNonce, oauthNonceCookieOptions } from "./oauth-browser-binding";

export const TAX_AUTHORITY_CALLBACK_PATH = "/api/tax-authority/callback";
export const TAX_AUTHORITY_OAUTH_NONCE_COOKIE = "ita_oauth_nonce";
/** Matches the tax_authority_oauth_states.expires_at default (10 minutes). */
export const TAX_AUTHORITY_STATE_TTL_SECONDS = 600;

const STATE_SHAPE = /^[0-9a-f]{48}$/;

export function taxAuthorityStateFromNonce(nonce: string): string {
  return hashOAuthNonce(nonce, "hex").slice(0, 48);
}

export function isTaxAuthorityStateShape(state: string): boolean {
  return STATE_SHAPE.test(state);
}

/** True only when a cookie nonce is present and derives exactly this state. */
export function taxAuthorityNonceMatchesState(cookieNonce: string | null | undefined, state: string): boolean {
  if (!cookieNonce || !isTaxAuthorityStateShape(state)) return false;
  return constantTimeEqual(taxAuthorityStateFromNonce(cookieNonce), state);
}

export function taxAuthorityNonceCookieOptions(maxAgeSeconds: number = TAX_AUTHORITY_STATE_TTL_SECONDS) {
  return oauthNonceCookieOptions(TAX_AUTHORITY_CALLBACK_PATH, maxAgeSeconds);
}

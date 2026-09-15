// Browser binding for OAuth redirect flows (server only).
//
// A server-side state (signed or stored) proves "this business asked to
// connect a few minutes ago", but not "and the browser finishing the consent
// is the one that asked". Without that, a consent link started by one account
// can be completed in someone else's browser, attaching the wrong provider
// authorisation to a business.
//
// The pattern: the start route drops a random nonce into an HttpOnly cookie
// scoped to the callback path, the state carries only a hash of it, and the
// callback refuses to touch the authorisation code unless the browser brings
// back the cookie whose hash matches. The cookie is cleared on every outcome.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes, base64url. One per connect attempt. */
export function newOAuthNonce(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 of the nonce in the requested encoding. */
export function hashOAuthNonce(nonce: string, encoding: "base64url" | "hex" = "base64url"): string {
  return createHash("sha256").update(nonce, "utf8").digest(encoding);
}

/** Length-safe constant-time string comparison. Empty strings never match. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Attributes for a nonce cookie: HttpOnly, Secure, SameSite=Lax (Lax is what
 * lets it ride along on the top-level GET redirect back from the provider),
 * scoped to the callback path so no other route ever sees it.
 * Pass maxAgeSeconds 0 to clear it; name and path must match the original.
 */
export function oauthNonceCookieOptions(path: string, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path,
    maxAge: maxAgeSeconds,
  };
}

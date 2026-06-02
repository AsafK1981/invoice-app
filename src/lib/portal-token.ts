import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC-SHA256 signed payload for the customer-portal magic link.
//
// The portal is a "no-account" experience: customers prove ownership of
// their email by clicking a link sent to that email. The signed token
// in the link is what we trust — we never write a customer row.
//
// Structure (URL-safe base64):
//   payload = JSON.stringify({ email, exp })
//   token   = base64url(payload) + "." + base64url(hmac(payload))

const SECRET = process.env.PORTAL_TOKEN_SECRET || "";

if (!SECRET && process.env.NODE_ENV === "production") {
  // Don't crash dev/test — but in production a missing secret means
  // anyone can mint tokens (or none can). Either way: refuse to operate.
  console.error("PORTAL_TOKEN_SECRET missing — portal will refuse requests");
}

const ENCODER = new TextEncoder();

function base64UrlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}

export interface PortalTokenPayload {
  email: string;
  /** ms-since-epoch expiry */
  exp: number;
}

/** Mint a token good for `ttlMs` milliseconds. */
export function signPortalToken(email: string, ttlMs: number): string {
  if (!SECRET) throw new Error("PORTAL_TOKEN_SECRET not configured");
  const payload: PortalTokenPayload = {
    email: email.toLowerCase().trim(),
    exp: Date.now() + ttlMs,
  };
  const body = JSON.stringify(payload);
  const bodyB64 = base64UrlEncode(ENCODER.encode(body));
  const sig = createHmac("sha256", SECRET).update(bodyB64).digest();
  return `${bodyB64}.${base64UrlEncode(sig)}`;
}

/** Verify + decode. Returns null on any failure (bad sig, expired, malformed). */
export function verifyPortalToken(token: string): PortalTokenPayload | null {
  if (!SECRET) return null;
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const bodyB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = createHmac("sha256", SECRET).update(bodyB64).digest();
    provided = base64UrlDecode(sigB64);
  } catch {
    return null;
  }
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  let payload: PortalTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(bodyB64).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.email !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < Date.now()) return null;
  return payload;
}

export const PORTAL_LINK_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const PORTAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
export const PORTAL_COOKIE = "portal_session";

// Column-level encryption for sensitive secrets stored in Postgres
// (Tax Authority OAuth tokens, etc.). RLS keeps the rows hidden from
// users, but if the database is ever exfiltrated, plaintext tokens
// would let an attacker impersonate every connected עוסק מורשה at
// gov.il. Section 18 of the info-security appendix explicitly lists
// Access Token, Refresh Token, and Client Secret as values that must
// be stored encrypted.
//
// Scheme: AES-256-GCM, 96-bit random IV per encryption, 128-bit auth
// tag. Output is base64 of: iv (12 bytes) || ciphertext || tag (16).
//
// Key: 32 raw bytes, hex-encoded in the env var
// `COLUMN_ENCRYPTION_KEY`. Rotate by re-encrypting all rows; the
// scheme prefixes each output with a 1-byte version so future
// algorithm changes can co-exist with old rows.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 0x01; // bump if scheme changes
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.COLUMN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "COLUMN_ENCRYPTION_KEY env var is missing; required to encrypt/decrypt Tax Authority tokens. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (hex.length !== 64) {
    throw new Error("COLUMN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function encryptColumn(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, ct, tag]).toString("base64");
}

export function decryptColumn(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < 1 + IV_LEN + TAG_LEN) {
    throw new Error("encrypted blob too short");
  }
  const version = buf.readUInt8(0);
  if (version !== VERSION) {
    throw new Error(`unsupported encryption version ${version}`);
  }
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(1 + IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Helper for the common case: encrypted may be null/empty (token not
 * yet stored). Returns null in that case instead of throwing.
 */
export function decryptColumnOrNull(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  return decryptColumn(encoded);
}

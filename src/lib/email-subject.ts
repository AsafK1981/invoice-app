/**
 * Sanitize a user-supplied email subject before it goes into a mail header:
 * strip CR/LF (header-injection defense) and cap the length. Falls back to
 * `fallback` when the input is empty.
 */
export function sanitizeEmailSubject(raw: unknown, fallback: string): string {
  const s = String(raw ?? "").replace(/[\r\n]+/g, " ").trim();
  return (s || fallback).slice(0, 200);
}

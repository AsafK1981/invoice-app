/**
 * The assistant's memory: short facts the user confirmed, injected into the
 * system prompt of every later conversation (see lib/assistant-system).
 *
 * This module is deliberately dependency-free so the same bounds apply on both
 * sides of the wire: the server normalises what the model proposes, the
 * browser normalises again before the INSERT it performs with the user's own
 * session, and the prompt builder normalises once more on the way in - a row
 * written by any other path still cannot smuggle newlines or a fake data
 * boundary into the prompt.
 */

/** Longest fact we store. Matches the CHECK in the migration. */
export const MEMORY_FACT_MAX_CHARS = 200;

/** Facts per business. Matches the BEFORE INSERT trigger in the migration. */
export const MEMORY_MAX_FACTS = 30;

/** Fired after a confirmed add/delete so an open settings screen refetches. */
export const MEMORY_CHANGED_EVENT = "invoice-app:assistant-memory-changed";

/** Control characters, DEL, and the two Unicode line separators. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

/**
 * One line of plain text, or "" when there is nothing usable.
 *
 * Control characters and line separators go first: a fact is rendered inside a
 * line-per-fact DATA block, so a newline would let one row pose as several.
 * Runs of angle brackets go with them - they are what the block's own
 * markers are made of, and a fact must not be able to close the boundary it
 * sits inside.
 */
export function normalizeFact(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(CONTROL_CHARS, " ")
    .replace(/<{2,}|>{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEMORY_FACT_MAX_CHARS)
    .trim();
}

/** Same fact, ignoring case and spacing. Used to refuse near-duplicates. */
export function sameFact(a: string, b: string): boolean {
  return normalizeFact(a).toLowerCase() === normalizeFact(b).toLowerCase();
}

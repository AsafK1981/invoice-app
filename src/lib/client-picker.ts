import type { Client } from "./types";

/**
 * Normalizes a tax id for comparison purposes: strips everything but
 * digits, so "514-123-456" and "514 123 456" and "514123456" all compare
 * equal. Returns "" for missing/blank input (never treated as a match).
 */
export function normalizeTaxId(taxId: string | undefined | null): string {
  return (taxId || "").replace(/\D/g, "");
}

/**
 * Normalizes a client name for comparison purposes: trims surrounding
 * whitespace and case-folds. Returns "" for missing/blank input.
 */
export function normalizeName(name: string | undefined | null): string {
  return (name || "").trim().toLowerCase();
}

/**
 * Finds an existing client that a newly-typed "לקוח חדש" entry should be
 * linked to instead of creating a duplicate: same normalized tax id, or -
 * when the new entry has no tax id - the same trimmed, case-insensitive
 * name. Used by the "שמור אותו ברשימת הלקוחות שלי" checkbox in the document
 * editor.
 */
export function findMatchingClient(
  clients: Client[],
  candidate: { name: string; taxId?: string }
): Client | undefined {
  const candidateTaxId = normalizeTaxId(candidate.taxId);
  if (candidateTaxId) {
    return clients.find((c) => normalizeTaxId(c.taxId) === candidateTaxId);
  }
  const candidateName = normalizeName(candidate.name);
  if (!candidateName) return undefined;
  return clients.find((c) => normalizeName(c.name) === candidateName);
}

/**
 * Filters the client list for the "לקוח קיים" search box: case-insensitive
 * substring match on the client name. An empty/whitespace query returns
 * every client (the list is visible immediately, not just after typing).
 */
export function filterClientsByQuery(clients: Client[], query: string): Client[] {
  const q = query.trim().toLowerCase();
  if (!q) return clients;
  return clients.filter((c) => c.name.toLowerCase().includes(q));
}

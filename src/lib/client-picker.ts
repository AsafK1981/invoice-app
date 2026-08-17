import type { Client, InvoiceDocument } from "./types";

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
 * whitespace, collapses internal runs of whitespace to one space and
 * case-folds. Returns "" for missing/blank input. The whitespace collapse
 * matters in practice: a saved client "גינדין אנה  מוסך זהב" (double space)
 * and a typed "גינדין אנה מוסך זהב" are the same customer.
 */
export function normalizeName(name: string | undefined | null): string {
  return (name || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Does this document belong to this client? True when the document carries the
 * client's id, OR when it carries no client id at all (typed free-text before
 * the "new client saves the client" default existed, WhatsApp/assistant docs
 * that were not matched, imports) and its stored name / tax id identifies the
 * same customer. A document linked to a DIFFERENT client id is never claimed,
 * even on a name match - the explicit link wins.
 *
 * Every screen that counts, sums or lists "this client's documents" must go
 * through here (or documentsForClient / resolveDocumentClientId), so a client
 * never shows "1 document" while the documents list shows two.
 */
export function documentBelongsToClient(
  doc: Pick<InvoiceDocument, "clientId" | "clientName" | "clientTaxId">,
  client: Pick<Client, "id" | "name" | "taxId">,
): boolean {
  if (doc.clientId) return doc.clientId === client.id;
  const docTaxId = normalizeTaxId(doc.clientTaxId);
  const clientTaxId = normalizeTaxId(client.taxId);
  if (docTaxId && clientTaxId) return docTaxId === clientTaxId;
  const name = normalizeName(doc.clientName);
  return !!name && name === normalizeName(client.name);
}

/**
 * All documents that belong to `client`: linked by id, plus unlinked documents
 * that resolve to this client and to NO other client in `allClients` (see
 * resolveDocumentClientId). Passing the full client list is what keeps two
 * same-named clients from both claiming the same unlinked document.
 */
export function documentsForClient<T extends Pick<InvoiceDocument, "clientId" | "clientName" | "clientTaxId">>(
  documents: T[],
  client: Pick<Client, "id" | "name" | "taxId">,
  allClients: Pick<Client, "id" | "name" | "taxId">[],
): T[] {
  return documents.filter((d) =>
    d.clientId ? d.clientId === client.id : resolveDocumentClientId(d, allClients) === client.id,
  );
}

/**
 * The client id a document should be attributed to: its own client id when
 * linked, otherwise the id of the single client its name / tax id identifies
 * (undefined when no client, or more than one, matches - an ambiguous
 * unlinked document is attributed to nobody rather than to the wrong person).
 */
export function resolveDocumentClientId(
  doc: Pick<InvoiceDocument, "clientId" | "clientName" | "clientTaxId">,
  clients: Pick<Client, "id" | "name" | "taxId">[],
): string | undefined {
  if (doc.clientId) return doc.clientId;
  const matches = clients.filter((c) => documentBelongsToClient(doc, c));
  if (matches.length <= 1) return matches[0]?.id;
  // A tax-id match outranks a name match: a document carrying tax id X
  // belongs to the client registered with X, not to a taxless namesake.
  const docTaxId = normalizeTaxId(doc.clientTaxId);
  if (docTaxId) {
    const byTax = matches.filter((c) => normalizeTaxId(c.taxId) === docTaxId);
    if (byTax.length === 1) return byTax[0].id;
  }
  return undefined;
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

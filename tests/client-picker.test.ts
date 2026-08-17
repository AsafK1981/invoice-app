import { describe, it, expect } from "vitest";
import {
  normalizeTaxId,
  normalizeName,
  findMatchingClient,
  filterClientsByQuery,
  documentBelongsToClient,
  documentsForClient,
  resolveDocumentClientId,
} from "@/lib/client-picker";
import type { Client } from "@/lib/types";

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "c-" + Math.random(),
    name: "לקוח לדוגמה",
    createdAt: "2026-01-01",
    ...overrides,
  };
}

describe("normalizeTaxId", () => {
  it("strips dashes and spaces", () => {
    expect(normalizeTaxId("514-123-456")).toBe("514123456");
    expect(normalizeTaxId("514 123 456")).toBe("514123456");
  });

  it("returns empty string for missing input", () => {
    expect(normalizeTaxId(undefined)).toBe("");
    expect(normalizeTaxId("")).toBe("");
  });
});

describe("normalizeName", () => {
  it("trims and lowercases", () => {
    expect(normalizeName("  Acme Corp  ")).toBe("acme corp");
  });

  it("returns empty string for missing input", () => {
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("findMatchingClient", () => {
  it("matches by normalized tax id when the candidate has one", () => {
    const clients = [
      makeClient({ id: "c1", name: "חברת אלפא", taxId: "514-123-456" }),
      makeClient({ id: "c2", name: "אחר", taxId: "999999999" }),
    ];
    const match = findMatchingClient(clients, { name: "אלפא בע״מ", taxId: "514123456" });
    expect(match?.id).toBe("c1");
  });

  it("does not match on tax id when no existing client shares it", () => {
    const clients = [makeClient({ id: "c1", name: "חברת אלפא", taxId: "514123456" })];
    const match = findMatchingClient(clients, { name: "לקוח אחר", taxId: "000000000" });
    expect(match).toBeUndefined();
  });

  it("falls back to trimmed, case-insensitive name when candidate has no tax id", () => {
    const clients = [makeClient({ id: "c1", name: "  Acme Corp  " })];
    const match = findMatchingClient(clients, { name: "acme corp" });
    expect(match?.id).toBe("c1");
  });

  it("does not match a different name when candidate has no tax id", () => {
    const clients = [makeClient({ id: "c1", name: "Acme Corp" })];
    const match = findMatchingClient(clients, { name: "Beta Corp" });
    expect(match).toBeUndefined();
  });

  it("returns undefined when candidate has neither a tax id nor a name", () => {
    const clients = [makeClient({ id: "c1", name: "Acme Corp" })];
    const match = findMatchingClient(clients, { name: "" });
    expect(match).toBeUndefined();
  });

  it("ignores a candidate tax id match against a client with a blank tax id", () => {
    const clients = [makeClient({ id: "c1", name: "Acme Corp", taxId: undefined })];
    const match = findMatchingClient(clients, { name: "Someone else", taxId: "123456789" });
    expect(match).toBeUndefined();
  });
});

describe("filterClientsByQuery", () => {
  const clients = [
    makeClient({ id: "c1", name: "חברת אלפא בע״מ" }),
    makeClient({ id: "c2", name: "בטא שירותים" }),
    makeClient({ id: "c3", name: "Gamma Ltd" }),
  ];

  it("returns every client for an empty query", () => {
    expect(filterClientsByQuery(clients, "")).toHaveLength(3);
    expect(filterClientsByQuery(clients, "   ")).toHaveLength(3);
  });

  it("filters case-insensitively by substring", () => {
    expect(filterClientsByQuery(clients, "gamma").map((c) => c.id)).toEqual(["c3"]);
  });

  it("matches a Hebrew substring", () => {
    expect(filterClientsByQuery(clients, "אלפא").map((c) => c.id)).toEqual(["c1"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterClientsByQuery(clients, "no such client")).toEqual([]);
  });
});

describe("normalizeName whitespace", () => {
  it("collapses internal whitespace runs", () => {
    expect(normalizeName("גינדין אנה  מוסך זהב")).toBe(normalizeName("גינדין אנה מוסך זהב"));
    expect(normalizeName("  Tim   Teddy ")).toBe("tim teddy");
  });
});

describe("documentBelongsToClient", () => {
  const anna = makeClient({ id: "anna", name: "גינדין אנה  מוסך זהב", taxId: "515199669" });
  const other = makeClient({ id: "other", name: "לקוח אחר" });
  const doc = (o: { clientId: string; clientName: string; clientTaxId?: string }) => o;

  it("matches a document linked by id regardless of name", () => {
    expect(documentBelongsToClient(doc({ clientId: "anna", clientName: "whatever" }), anna)).toBe(true);
  });

  it("never claims a document linked to a different client, even on a name match", () => {
    expect(documentBelongsToClient(doc({ clientId: "other", clientName: "גינדין אנה  מוסך זהב" }), anna)).toBe(false);
  });

  it("claims an unlinked document by normalized name (whitespace/case)", () => {
    expect(documentBelongsToClient(doc({ clientId: "", clientName: "גינדין אנה מוסך זהב" }), anna)).toBe(true);
    expect(documentBelongsToClient(doc({ clientId: "", clientName: "גינדין אנה מוסך זהב" }), other)).toBe(false);
  });

  it("prefers tax id when both sides have one", () => {
    expect(documentBelongsToClient(doc({ clientId: "", clientName: "שם אחר לגמרי", clientTaxId: "515-199-669" }), anna)).toBe(true);
    expect(documentBelongsToClient(doc({ clientId: "", clientName: "גינדין אנה מוסך זהב", clientTaxId: "000000018" }), anna)).toBe(false);
  });

  it("ignores blank names", () => {
    expect(documentBelongsToClient(doc({ clientId: "", clientName: "" }), makeClient({ name: "" }))).toBe(false);
  });
});

describe("documentsForClient / resolveDocumentClientId", () => {
  const a = makeClient({ id: "a", name: "Anna" });
  const b = makeClient({ id: "b", name: "Bob" });
  const twin = makeClient({ id: "a2", name: "anna" });
  const docs = [
    { id: "1", clientId: "a", clientName: "Anna" },
    { id: "2", clientId: "", clientName: "ANNA " },
    { id: "3", clientId: "b", clientName: "Anna" },
    { id: "4", clientId: "", clientName: "Bob" },
  ];

  it("lists linked + unlinked-by-name documents", () => {
    expect(documentsForClient(docs, a, [a, b]).map((d) => d.id)).toEqual(["1", "2"]);
    expect(documentsForClient(docs, b, [a, b]).map((d) => d.id)).toEqual(["3", "4"]);
  });

  it("gives an ambiguous unlinked document to NEITHER same-named client", () => {
    // Two saved clients named Anna: doc 2 must not be double-shown/summed.
    expect(documentsForClient(docs, a, [a, b, twin]).map((d) => d.id)).toEqual(["1"]);
    expect(documentsForClient(docs, twin, [a, b, twin]).map((d) => d.id)).toEqual([]);
  });

  it("prefers the tax-id match over a taxless namesake", () => {
    const withTax = makeClient({ id: "t", name: "Anna", taxId: "515199669" });
    const doc = { clientId: "", clientName: "Anna", clientTaxId: "515-199-669" };
    expect(resolveDocumentClientId(doc, [a, withTax])).toBe("t");
    expect(documentsForClient([doc], withTax, [a, withTax])).toHaveLength(1);
    expect(documentsForClient([doc], a, [a, withTax])).toHaveLength(0);
  });

  it("resolves an unlinked document to the single matching client, none when ambiguous", () => {
    expect(resolveDocumentClientId(docs[1], [a, b])).toBe("a");
    expect(resolveDocumentClientId(docs[1], [a, b, twin])).toBeUndefined();
    expect(resolveDocumentClientId(docs[2], [a, b])).toBe("b");
    expect(resolveDocumentClientId({ clientId: "", clientName: "Nobody" }, [a, b])).toBeUndefined();
  });
});

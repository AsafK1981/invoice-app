import { describe, it, expect } from "vitest";
import {
  normalizeTaxId,
  normalizeName,
  findMatchingClient,
  filterClientsByQuery,
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

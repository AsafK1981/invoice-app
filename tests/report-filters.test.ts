import { describe, it, expect } from "vitest";
import {
  filterDocuments,
  summarize,
  type ReportFilters,
} from "@/lib/report-filters";
import type { DocumentType, InvoiceDocument } from "@/lib/types";

const ALL_TYPES: DocumentType[] = [
  "receipt",
  "quote",
  "proforma",
  "tax_invoice",
  "tax_invoice_receipt",
  "credit_note",
];

/** A ReportFilters that passes everything, overridable per test. */
function allFilters(over: Partial<ReportFilters> = {}): ReportFilters {
  return {
    from: null,
    to: null,
    allocation: "all",
    clientId: "all",
    types: ALL_TYPES,
    status: "all",
    ...over,
  };
}

function doc(over: Partial<InvoiceDocument>): InvoiceDocument {
  return {
    id: Math.random().toString(36).slice(2),
    type: "tax_invoice",
    number: 1,
    date: "2026-06-15",
    clientId: "c1",
    clientName: "לקוח",
    status: "paid",
    items: [],
    subtotal: 100,
    vat: 0,
    total: 100,
    ...over,
  };
}

describe("filterDocuments: allocation", () => {
  const docs = [
    doc({ id: "with", allocationNumber: "187025961" }),
    doc({ id: "without", allocationNumber: undefined }),
    doc({ id: "blank", allocationNumber: "   " }), // whitespace = no allocation
  ];

  it("all keeps everything", () => {
    expect(filterDocuments(docs, allFilters({ allocation: "all" })).map((d) => d.id)).toEqual([
      "with",
      "without",
      "blank",
    ]);
  });

  it("with keeps only non-empty allocation numbers", () => {
    expect(filterDocuments(docs, allFilters({ allocation: "with" })).map((d) => d.id)).toEqual([
      "with",
    ]);
  });

  it("without keeps missing and whitespace-only allocation", () => {
    expect(filterDocuments(docs, allFilters({ allocation: "without" })).map((d) => d.id)).toEqual([
      "without",
      "blank",
    ]);
  });
});

describe("filterDocuments: date range", () => {
  const docs = [
    doc({ id: "jan", date: "2026-01-01" }),
    doc({ id: "jun", date: "2026-06-15" }),
    doc({ id: "dec", date: "2026-12-31" }),
  ];

  it("inclusive lower and upper edges", () => {
    const res = filterDocuments(docs, allFilters({ from: "2026-01-01", to: "2026-12-31" }));
    expect(res.map((d) => d.id)).toEqual(["jan", "jun", "dec"]);
  });

  it("excludes just outside the edges", () => {
    const res = filterDocuments(docs, allFilters({ from: "2026-01-02", to: "2026-12-30" }));
    expect(res.map((d) => d.id)).toEqual(["jun"]);
  });

  it("open-ended lower bound (only to)", () => {
    const res = filterDocuments(docs, allFilters({ from: null, to: "2026-06-15" }));
    expect(res.map((d) => d.id)).toEqual(["jan", "jun"]);
  });

  it("open-ended upper bound (only from)", () => {
    const res = filterDocuments(docs, allFilters({ from: "2026-06-15", to: null }));
    expect(res.map((d) => d.id)).toEqual(["jun", "dec"]);
  });

  it("both null = all time", () => {
    expect(filterDocuments(docs, allFilters()).length).toBe(3);
  });
});

describe("filterDocuments: client", () => {
  const docs = [
    doc({ id: "a", clientId: "c1" }),
    doc({ id: "b", clientId: "c2" }),
  ];

  it("all keeps every client", () => {
    expect(filterDocuments(docs, allFilters({ clientId: "all" })).length).toBe(2);
  });

  it("specific clientId keeps only that client", () => {
    expect(filterDocuments(docs, allFilters({ clientId: "c2" })).map((d) => d.id)).toEqual(["b"]);
  });
});

describe("filterDocuments: type", () => {
  const docs = [
    doc({ id: "ti", type: "tax_invoice" }),
    doc({ id: "rc", type: "receipt" }),
    doc({ id: "qt", type: "quote" }),
  ];

  it("keeps only documents whose type is selected", () => {
    const res = filterDocuments(docs, allFilters({ types: ["tax_invoice", "receipt"] }));
    expect(res.map((d) => d.id)).toEqual(["ti", "rc"]);
  });

  it("empty type selection keeps nothing", () => {
    expect(filterDocuments(docs, allFilters({ types: [] })).length).toBe(0);
  });
});

describe("filterDocuments: status", () => {
  const docs = [
    doc({ id: "paid", status: "paid" }),
    doc({ id: "draft", status: "draft" }),
    doc({ id: "sent", status: "sent" }),
    doc({ id: "cancelled", status: "cancelled" }),
  ];

  it("all keeps every status", () => {
    expect(filterDocuments(docs, allFilters({ status: "all" })).length).toBe(4);
  });

  it("specific status keeps only that status", () => {
    expect(filterDocuments(docs, allFilters({ status: "draft" })).map((d) => d.id)).toEqual([
      "draft",
    ]);
  });
});

describe("filterDocuments: combined query", () => {
  // "tax invoices WITH allocation for client c1 in 2026"
  const docs = [
    doc({ id: "hit", type: "tax_invoice", clientId: "c1", date: "2026-05-01", allocationNumber: "1", status: "paid" }),
    doc({ id: "wrongType", type: "receipt", clientId: "c1", date: "2026-05-01", allocationNumber: "1" }),
    doc({ id: "noAlloc", type: "tax_invoice", clientId: "c1", date: "2026-05-01", allocationNumber: undefined }),
    doc({ id: "wrongClient", type: "tax_invoice", clientId: "c2", date: "2026-05-01", allocationNumber: "1" }),
    doc({ id: "outOfRange", type: "tax_invoice", clientId: "c1", date: "2025-12-31", allocationNumber: "1" }),
  ];

  it("intersects every predicate", () => {
    const res = filterDocuments(
      docs,
      allFilters({
        types: ["tax_invoice"],
        allocation: "with",
        clientId: "c1",
        from: "2026-01-01",
        to: "2026-12-31",
      }),
    );
    expect(res.map((d) => d.id)).toEqual(["hit"]);
  });
});

describe("summarize", () => {
  it("counts and sums totalIls ?? total, including a negative credit note", () => {
    const docs = [
      doc({ total: 100, totalIls: 100 }),
      doc({ total: 200 }), // no totalIls → falls back to total
      doc({ type: "credit_note", total: -50, totalIls: -50 }),
    ];
    expect(summarize(docs)).toEqual({ count: 3, total: 250 });
  });

  it("empty set", () => {
    expect(summarize([])).toEqual({ count: 0, total: 0 });
  });
});

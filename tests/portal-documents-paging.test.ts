import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The client portal shows a client their own balance, so a short list is worse
// than an error: PostgREST caps an unpaginated select at 1,000 rows, and the
// portal used to issue exactly that. These tests prove the route now pages
// through everything, and that a list it cannot vouch for becomes an error
// rather than quietly understated totals.

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  return {
    documents: [] as Record<string, unknown>[],
    // When set, the documents count grows by one on every page after the
    // first, the way a document issued mid-load would move it.
    driftCount: false,
    // The route builds a fresh query object per page, so the page counter has
    // to live out here to survive across them.
    documentPages: 0,
  };
});

vi.mock("@/lib/portal-token", () => ({
  PORTAL_COOKIE: "portal_session",
  verifyPortalToken: () => ({ email: "dana@example.com" }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      const rowsFor = () => {
        if (table === "clients") return [{ id: "client-1", business_id: "biz-1", name: "דנה" }];
        if (table === "businesses") return [{ id: "biz-1", name: "העסק" }];
        return h.documents;
      };
      let from = 0;
      let to = Number.MAX_SAFE_INTEGER;
      const q: Record<string, unknown> = {
        select: () => q,
        ilike: () => q,
        in: () => q,
        neq: () => q,
        order: () => q,
        range: (a: number, b: number) => {
          from = a;
          to = b;
          return q;
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          const all = rowsFor();
          let drift = 0;
          if (table === "documents") {
            drift = h.driftCount ? h.documentPages : 0;
            h.documentPages += 1;
          }
          return Promise.resolve({
            data: all.slice(from, to + 1),
            error: null,
            count: all.length + drift,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  }),
}));

function request() {
  const req = new NextRequest("https://friendlyinvoice.co.il/api/portal/documents");
  req.cookies.set("portal_session", "token");
  return req;
}

function seed(count: number) {
  h.documents = Array.from({ length: count }, (_, i) => ({
    id: `doc-${String(i).padStart(5, "0")}`,
    type: "tax_invoice",
    number: i + 1,
    // Ascending dates, so the newest document is the last one seeded.
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    status: "sent",
    total: 100,
    total_ils: 100,
    client_id: "client-1",
    business_id: "biz-1",
    converted_to_id: null,
    original_document_id: null,
  }));
}

beforeEach(() => {
  h.driftCount = false;
  h.documentPages = 0;
  vi.resetModules();
});

describe("portal documents route", () => {
  it("returns every document past the 1,000 row cap", async () => {
    seed(1200);
    const { GET } = await import("@/app/api/portal/documents/route");
    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.documents).toHaveLength(1200);
    // No row is served twice by the overlapping-range mistake.
    expect(new Set(body.documents.map((d: { id: string }) => d.id)).size).toBe(1200);
  });

  it("lists the newest document first", async () => {
    seed(30);
    const { GET } = await import("@/app/api/portal/documents/route");
    const body = await (await GET(request())).json();

    const dates = body.documents.map((d: { date: string }) => d.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("fails loudly instead of returning a partial list", async () => {
    seed(1200);
    h.driftCount = true;
    const { GET } = await import("@/app/api/portal/documents/route");
    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("נסו שוב");
    expect(body.documents).toBeUndefined();
  });

  it("does not leak another document's id through original_document_id", async () => {
    seed(3);
    h.documents[0].original_document_id = "doc-not-in-this-list";
    h.documents[1].converted_to_id = "doc-00002";
    const { GET } = await import("@/app/api/portal/documents/route");
    const body = await (await GET(request())).json();

    type PortalDoc = {
      id: string;
      converted: boolean;
      converted_to_id?: string;
      original_document_id: string | null;
    };
    const byId = new Map<string, PortalDoc>(
      (body.documents as PortalDoc[]).map((d) => [d.id, d]),
    );
    expect(byId.get("doc-00000")?.original_document_id).toBeNull();
    expect(byId.get("doc-00001")?.converted).toBe(true);
    expect(byId.get("doc-00001")?.converted_to_id).toBeUndefined();
  });
});

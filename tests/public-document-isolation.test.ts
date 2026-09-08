import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  document: null as Record<string, unknown> | null,
  clients: [] as Record<string, unknown>[],
  clientQueries: 0,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        order: async () => ({ data: [], error: null }),
        maybeSingle: async () => {
          if (table === "documents") return { data: state.document, error: null };
          if (table === "clients") {
            state.clientQueries++;
            return {
              data: state.clients.find((row) =>
                Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null,
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "isolation-test" }));

import { GET } from "@/app/api/public-document/[id]/route";

const id = "11111111-1111-4111-8111-111111111111";
const getDocument = () => GET(new Request(`https://example.test/api/public-document/${id}`), {
  params: Promise.resolve({ id }),
});

beforeEach(() => {
  state.document = { id, business_id: "business-a", client_id: "client-a" };
  state.clients = [{ id: "client-a", business_id: "business-a", name: "Synthetic same-business client" }];
  state.clientQueries = 0;
});

describe("public document client isolation", () => {
  it("returns a client belonging to the document's business", async () => {
    const body = await (await getDocument()).json();
    expect(body.client?.name).toBe("Synthetic same-business client");
  });

  it("does not disclose a foreign client's details from a legacy invalid reference", async () => {
    state.clients = [{ id: "client-a", business_id: "business-b", name: "Must never be returned" }];
    const body = await (await getDocument()).json();
    expect(body.ok).toBe(true);
    expect(body.client).toBeNull();
    expect(JSON.stringify(body)).not.toContain("Must never be returned");
  });

  it("keeps documents without a client readable and skips the client query", async () => {
    state.document!.client_id = null;
    const body = await (await getDocument()).json();
    expect(body.client).toBeNull();
    expect(state.clientQueries).toBe(0);
  });
});

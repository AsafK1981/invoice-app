import { describe, it, expect, vi, beforeEach } from "vitest";

// Quote approval from the public page: the pure verdict, and the route
// against an in-memory Supabase whose conditional UPDATE only matches rows
// that still satisfy every filter, like Postgres does.

type Row = Record<string, unknown>;

const state = vi.hoisted(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  return { docs: [] as Row[], notifications: [] as Array<{ body: string }> };
});

vi.mock("@/lib/notifications-server", () => ({
  createNotificationForBusiness: vi.fn(async (args: { body: string }) => {
    state.notifications.push(args);
    return true;
  }),
}));

vi.mock("@/lib/rate-limit", () => ({ clientIp: () => `ip-${Math.random()}` }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from() {
      const filters: Array<(r: Row) => boolean> = [];
      let patch: Row | null = null;
      let single = false;
      const q = {
        select() { return q; },
        update(p: Row) { patch = p; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return q; },
        maybeSingle() { single = true; return q; },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          // Resolve on a later tick so two requests interleave their reads
          // before either write, which is the race being tested.
          return new Promise((r) => setTimeout(r, 0)).then(() => {
            const matched = state.docs.filter((d) => filters.every((f) => f(d)));
            if (patch) {
              matched.forEach((d) => Object.assign(d, patch));
              return resolve({ data: matched.map((d) => ({ id: d.id })), error: null });
            }
            const copies = matched.map((d) => ({ ...d }));
            return resolve({ data: single ? copies[0] ?? null : copies, error: null });
          });
        },
      };
      return q;
    },
  }),
}));

import { quoteApprovalVerdict } from "@/lib/quote-approval";
import { POST } from "@/app/api/public-document/[id]/approve/route";

const ID = "11111111-1111-4111-8111-111111111111";

function quote(over: Row = {}): Row {
  return {
    id: ID,
    type: "quote",
    status: "sent",
    approved_at: null,
    converted_to_id: null,
    business_id: "b1",
    client_name: "Dana",
    number: 4,
    total: 3600,
    currency: "ILS",
    ...over,
  };
}

function approve(signature = "Dana Levi") {
  return POST(
    new Request(`http://localhost/api/public-document/${ID}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature }),
    }),
    { params: Promise.resolve({ id: ID }) },
  );
}

beforeEach(() => {
  state.docs = [];
  state.notifications = [];
});

describe("quoteApprovalVerdict", () => {
  const base = { type: "quote", status: "sent", approved_at: null, converted_to_id: null };

  it("allows an issued, open quote", () => {
    expect(quoteApprovalVerdict(base)).toEqual({ kind: "ok" });
  });

  it("rejects non-quotes with 400", () => {
    expect(quoteApprovalVerdict({ ...base, type: "tax_invoice" })).toMatchObject({ kind: "rejected", status: 400 });
  });

  it("reports an existing approval instead of approving again", () => {
    expect(quoteApprovalVerdict({ ...base, approved_at: "2026-09-01T10:00:00Z" })).toEqual({
      kind: "already_approved",
      approvedAt: "2026-09-01T10:00:00Z",
    });
  });

  it.each([
    ["draft", { status: "draft" }],
    ["cancelled", { status: "cancelled" }],
    ["paid", { status: "paid" }],
    ["converted", { converted_to_id: "doc-2" }],
  ])("rejects a %s quote with 409", (_label, over) => {
    expect(quoteApprovalVerdict({ ...base, ...over })).toMatchObject({ kind: "rejected", status: 409 });
  });
});

describe("POST /api/public-document/[id]/approve", () => {
  it("approves an open quote once and notifies with the document currency", async () => {
    state.docs = [quote({ currency: "USD" })];
    const res = await approve();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(state.docs[0].approved_at).toBeTruthy();
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].body).toContain("$3,600.00");
    expect(state.notifications[0].body).not.toContain("₪");
  });

  it.each([
    ["cancelled", { status: "cancelled" }],
    ["draft", { status: "draft" }],
    ["converted", { converted_to_id: "doc-2" }],
  ])("refuses a %s quote and changes nothing", async (_label, over) => {
    state.docs = [quote(over)];
    const res = await approve();
    expect(res.status).toBe(409);
    expect(state.docs[0].approved_at).toBeNull();
    expect(state.notifications).toHaveLength(0);
  });

  it("notifies only once when two approvals race", async () => {
    state.docs = [quote()];
    const [a, b] = await Promise.all([approve("First"), approve("Second")]);
    const bodies = [await a.json(), await b.json()];
    expect(bodies.every((x) => x.ok)).toBe(true);
    expect(bodies.filter((x) => x.alreadyApproved)).toHaveLength(1);
    expect(state.notifications).toHaveLength(1);
  });
});

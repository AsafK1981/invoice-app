import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * /api/billing/cancel under a self-managed processor (2026-09-23).
 *
 * The bug this file pins down: the route used to set only
 * app_metadata.plan_cancel_at_period_end while its own comment claimed "the
 * recurring-billing cron reads this flag to stop charging at the period
 * boundary". Nothing read it, so a cancelled subscriber kept being charged
 * forever. Cancellation now also writes the scheduler row the cron actually
 * looks at - and refuses to report success if that write fails.
 *
 * Its counterpart is tests/subscription-billing-dispatch.test.ts, which proves
 * the cron honours both flags.
 */

type Row = Record<string, unknown>;

const USER = "33333333-3333-3333-3333-333333333333";

const state = vi.hoisted(() => {
  process.env.PAYMENT_PROVIDER = "tranzila";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
  return {
    appMeta: {} as Row,
    subscriptionUpdates: [] as Row[],
    updateError: null as { message: string } | null,
    metaWrites: 0,
  };
});

vi.mock("@supabase/supabase-js", () => {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: USER, email: "sub@example.com" } }, error: null }),
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { id, app_metadata: state.appMeta } },
          error: null,
        }),
        updateUserById: async (_id: string, attrs: { app_metadata?: Row }) => {
          state.metaWrites += 1;
          state.appMeta = { ...(attrs.app_metadata || {}) };
          return { data: { user: { id: USER } }, error: null };
        },
      },
    },
    from() {
      const q = {
        update(p: Row) {
          state.subscriptionUpdates.push(p);
          return q;
        },
        eq() {
          return q;
        },
        then(resolve: (v: { data: null; error: unknown }) => void) {
          return Promise.resolve(resolve({ data: null, error: state.updateError }));
        },
      };
      return q;
    },
  };
  return { createClient: () => client };
});

import { POST } from "@/app/api/billing/cancel/route";

function request(action: string) {
  return new Request("https://friendlyinvoice.co.il/api/billing/cancel", {
    method: "POST",
    headers: { Authorization: "Bearer session", "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  }) as never;
}

beforeEach(() => {
  state.appMeta = { payment_provider: "tranzila", plan_active: true, plan_tier: "pro" };
  state.subscriptionUpdates = [];
  state.updateError = null;
  state.metaWrites = 0;
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cancel under a self-managed provider", () => {
  it("flags the scheduler row AND app_metadata", async () => {
    const res = await POST(request("cancel"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, cancelAtPeriodEnd: true });
    // The row the cron selects: this is what actually stops the money.
    expect(state.subscriptionUpdates).toHaveLength(1);
    expect(state.subscriptionUpdates[0].cancel_at_period_end).toBe(true);
    expect(state.appMeta.plan_cancel_at_period_end).toBe(true);
    // Access is NOT revoked now; they keep it to the period boundary.
    expect(state.appMeta.plan_active).toBe(true);
  });

  it("clears both flags on resume", async () => {
    state.appMeta = { ...state.appMeta, plan_cancel_at_period_end: true };

    await POST(request("resume"));

    expect(state.subscriptionUpdates[0].cancel_at_period_end).toBe(false);
    expect(state.appMeta.plan_cancel_at_period_end).toBe(false);
  });

  it("cancels a Grow-era subscription too, whichever provider is live now", async () => {
    state.appMeta = { payment_provider: "grow", plan_active: true };

    const res = await POST(request("cancel"));

    expect(res.status).toBe(200);
    expect(state.subscriptionUpdates[0].cancel_at_period_end).toBe(true);
  });

  it("refuses for a provider that manages its own portal", async () => {
    state.appMeta = { payment_provider: "polar", plan_active: true };

    const res = await POST(request("cancel"));

    expect(res.status).toBe(409);
    expect(state.subscriptionUpdates).toHaveLength(0);
  });

  it("never reports success when the scheduler row could not be flagged", async () => {
    state.updateError = { message: "connection reset" };

    const res = await POST(request("cancel"));

    expect(res.status).toBe(500);
    // Fail closed: telling someone "cancelled" while the thing that charges
    // their card was never told is the failure mode worth avoiding.
    expect(state.metaWrites).toBe(0);
    expect(state.appMeta.plan_cancel_at_period_end).toBeUndefined();
  });
});

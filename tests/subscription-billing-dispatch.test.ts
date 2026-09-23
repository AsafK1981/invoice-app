import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The recurring-billing cron's safety rails (2026-09-23).
 *
 * This route charges saved cards on an unattended schedule and can downgrade a
 * paying customer, so the interesting cases are all the ones where it must NOT
 * act:
 *
 *   - a row whose provider is not the live provider is never charged;
 *   - a Tranzila token with no card expiry is a DATA GAP: skip loudly, never
 *     dun (dunning emails a paying customer that their payment failed and
 *     cancels them after 5 days - over a field we failed to capture);
 *   - a transport/config failure is not a decline, and must not dun either;
 *   - a cancelled subscription is closed at the boundary, not charged.
 *
 * Only a real processor decline is allowed to start the dunning ladder.
 */

type Row = Record<string, unknown>;
type Err = { message: string } | null;

const USER = "22222222-2222-2222-2222-222222222222";
const TOKEN = "O5d55d2922ca4021382";

const state = vi.hoisted(() => {
  process.env.CRON_SECRET = "cron-secret";
  process.env.PAYMENT_PROVIDER = "tranzila";
  process.env.TRANZILA_TERMINAL = "friendinv";
  process.env.TRANZILA_PASSWORD = "pw";
  process.env.TRANZILA_APP_KEY = "key";
  process.env.TRANZILA_APP_SECRET = "secret";
  process.env.GMAIL_USER = "app@example.com";
  process.env.GMAIL_APP_PASSWORD = "pass word";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  delete process.env.SAAS_VENDOR_BUSINESS_ID;
  return {
    tables: {} as Record<string, Row[]>,
    appMeta: {} as Record<string, Row>,
    mails: [] as Array<{ subject: string }>,
  };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: { subject: string }) => {
        state.mails.push(m);
        return {};
      },
    }),
  },
}));

vi.mock("@/lib/documents-server", () => ({
  issueSelfInvoice: vi.fn(async () => ({ documentId: "doc-1" })),
}));

const tranzilaCharge = vi.hoisted(() => vi.fn());
const growCharge = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tranzila", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tranzila")>()),
  chargeToken: tranzilaCharge,
}));
vi.mock("@/lib/grow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grow")>()),
  chargeToken: growCharge,
}));

vi.mock("@supabase/supabase-js", () => {
  const client = {
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { id, email: "sub@example.com", app_metadata: state.appMeta[id] || {} } },
          error: null,
        }),
        updateUserById: async (id: string, attrs: { app_metadata?: Row }) => {
          state.appMeta[id] = { ...(attrs.app_metadata || {}) };
          return { data: { user: { id } }, error: null };
        },
      },
    },
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: Row = {};

      const exec = async (): Promise<{ data: Row[]; error: Err }> => {
        const rows = (state.tables[table] ??= []);
        const match = (r: Row) => filters.every((f) => f(r));
        if (op === "insert") {
          rows.push({ ...payload });
          return { data: [{ ...payload }], error: null };
        }
        if (op === "update") {
          const hit = rows.filter(match);
          hit.forEach((r) => Object.assign(r, payload));
          return { data: hit.map((r) => ({ ...r })), error: null };
        }
        return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
      };

      const q = {
        select() { return q; },
        insert(p: Row) { op = "insert"; payload = p; return q; },
        update(p: Row) { op = "update"; payload = p; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return q; },
        lte(k: string, v: string) { filters.push((r) => String(r[k]) <= v); return q; },
        limit() { return q; },
        async maybeSingle() {
          const { data, error } = await exec();
          return { data: data[0] ?? null, error };
        },
        then(resolve: (v: { data: Row[]; error: Err }) => void, reject?: (e: unknown) => void) {
          return exec().then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { createClient: () => client };
});

import { GET } from "@/app/api/cron/subscription-billing/route";
import { TranzilaApiError } from "@/lib/tranzila";

function subscription(over: Row = {}): Row {
  return {
    id: "sub-1",
    user_id: USER,
    business_id: null,
    tier: "pro",
    interval: "month",
    provider: "tranzila",
    provider_token: TOKEN,
    card_exp_month: 11,
    card_exp_year: 2029,
    cancel_at_period_end: false,
    current_period_end: "2020-01-01",
    status: "active",
    retry_count: 0,
    first_failed_at: null,
    last_charge_at: null,
    ...over,
  };
}

function run() {
  return GET(
    new Request("https://friendlyinvoice.co.il/api/cron/subscription-billing", {
      headers: { Authorization: "Bearer cron-secret" },
    }),
  );
}

async function runJson(): Promise<Record<string, unknown>> {
  const res = await run();
  return (await res.json()) as Record<string, unknown>;
}

const row = () => state.tables.subscriptions[0];
const charges = () => state.tables.subscription_charge_log ?? [];

beforeEach(() => {
  state.tables = {};
  state.appMeta = {};
  state.mails = [];
  tranzilaCharge.mockReset();
  growCharge.mockReset();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("provider agreement", () => {
  it("never charges a row belonging to a different provider", async () => {
    state.tables.subscriptions = [subscription({ provider: "grow" })];

    const body = await runJson();

    expect(tranzilaCharge).not.toHaveBeenCalled();
    expect(growCharge).not.toHaveBeenCalled();
    expect(body.charged).toBe(0);
    expect(JSON.stringify(body.details)).toContain("!= active provider");
    // Untouched: not charged, not dunned, not downgraded.
    expect(row().status).toBe("active");
    expect(row().current_period_end).toBe("2020-01-01");
  });

  it("charges a row that does match the live provider", async () => {
    state.tables.subscriptions = [subscription()];
    tranzilaCharge.mockResolvedValue({ success: true, transactionId: "15009" });

    const body = await runJson();

    expect(body.charged).toBe(1);
    expect(tranzilaCharge).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN, sum: 25, expireMonth: 11, expireYear: 2029 }),
    );
    expect(charges()[0]).toMatchObject({
      provider: "tranzila",
      transaction_id: "15009",
      amount: 25,
      success: true,
    });
    expect(row().status).toBe("active");
    expect(row().current_period_end).not.toBe("2020-01-01");
    expect(state.appMeta[USER].plan_active).toBe(true);
  });
});

describe("data gaps are skipped, never dunned", () => {
  it("skips a Tranzila token with no card expiry", async () => {
    state.tables.subscriptions = [subscription({ card_exp_month: null, card_exp_year: null })];

    const body = await runJson();

    expect(tranzilaCharge).not.toHaveBeenCalled();
    expect(JSON.stringify(body.details)).toContain("token without card expiry");
    // The dunning ladder must not have started: no past_due, no retry clock,
    // no "your payment failed" email, no downgrade.
    expect(row().status).toBe("active");
    expect(row().retry_count).toBe(0);
    expect(row().first_failed_at).toBeNull();
    expect(state.mails).toHaveLength(0);
    expect(body.failed).toBe(0);
    expect(body.downgraded).toBe(0);
  });

  it("skips a row with no token at all", async () => {
    state.tables.subscriptions = [subscription({ provider_token: null })];

    const body = await runJson();

    expect(tranzilaCharge).not.toHaveBeenCalled();
    expect(row().status).toBe("active");
    expect(body.failed).toBe(0);
  });

  it("does not dun when the charge could not be sent at all", async () => {
    state.tables.subscriptions = [subscription()];
    tranzilaCharge.mockRejectedValue(new TranzilaApiError("Network error calling Tranzila API v1"));

    const body = await runJson();

    expect(body.charged).toBe(0);
    expect(body.failed).toBe(0);
    expect(JSON.stringify(body.details)).toContain("charge unreachable");
    expect(row().status).toBe("active");
    expect(row().retry_count).toBe(0);
    expect(state.mails).toHaveLength(0);
  });

  it("does not dun when the charge code throws an unexpected error", async () => {
    state.tables.subscriptions = [subscription()];
    tranzilaCharge.mockRejectedValue(new TypeError("cannot read properties of undefined"));

    const body = await runJson();

    expect(body.failed).toBe(0);
    expect(row().status).toBe("active");
    expect(state.mails).toHaveLength(0);
  });

  it("DOES dun a genuine decline", async () => {
    state.tables.subscriptions = [subscription()];
    tranzilaCharge.mockResolvedValue({
      success: false,
      errorCode: 0,
      processorResponseCode: "004",
      transactionId: null,
    });

    const body = await runJson();

    expect(body.failed).toBe(1);
    expect(row().status).toBe("past_due");
    expect(row().retry_count).toBe(1);
    expect(row().first_failed_at).not.toBeNull();
    // Day 0 is not the final attempt, so no downgrade and no email yet.
    expect(body.downgraded).toBe(0);
    expect(state.mails).toHaveLength(0);
  });
});

describe("cancellation stops the next charge", () => {
  it("closes a row flagged cancel_at_period_end instead of charging it", async () => {
    state.tables.subscriptions = [subscription({ cancel_at_period_end: true })];
    state.appMeta[USER] = { plan_active: true, plan_tier: "pro" };

    const body = await runJson();

    expect(tranzilaCharge).not.toHaveBeenCalled();
    expect(charges()).toHaveLength(0);
    expect(row().status).toBe("canceled");
    expect(state.appMeta[USER].plan_active).toBe(false);
    expect(JSON.stringify(body.details)).toContain("cancelled at period end");
    // Closing a cancelled subscription is not a failed payment.
    expect(state.mails).toHaveLength(0);
    expect(body.failed).toBe(0);
  });

  it("also honours the flag when it only reached app_metadata", async () => {
    state.tables.subscriptions = [subscription({ cancel_at_period_end: null })];
    state.appMeta[USER] = { plan_active: true, plan_cancel_at_period_end: true };

    await runJson();

    expect(tranzilaCharge).not.toHaveBeenCalled();
    expect(row().status).toBe("canceled");
    expect(state.appMeta[USER].plan_active).toBe(false);
  });

  it("still charges a subscriber who has NOT cancelled", async () => {
    state.tables.subscriptions = [subscription()];
    state.appMeta[USER] = { plan_active: true, plan_cancel_at_period_end: false };
    tranzilaCharge.mockResolvedValue({ success: true, transactionId: "15010" });

    const body = await runJson();

    expect(body.charged).toBe(1);
    expect(row().status).toBe("active");
  });
});

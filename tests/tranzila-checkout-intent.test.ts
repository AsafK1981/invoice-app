import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The Tranzila capture flow's authentication story, end to end (2026-09-23).
 *
 * DirectNG signs nothing and Tranzila documents no transaction-query endpoint,
 * so a per-checkout single-use nonce is what proves a result POST belongs to a
 * checkout we started. These tests hold that story to its promises:
 *
 *   - the nonce rides on notify_url_address ONLY, never on the browser's URL;
 *   - it can be consumed exactly once, including under two simultaneous POSTs;
 *   - an unknown, replayed or non-approved result writes nothing;
 *   - identity/tier/amount come from the intent row, never from the payload;
 *   - the card token lands in subscriptions and NOWHERE in app_metadata.
 *
 * The in-memory Supabase below emulates the two things the design leans on:
 * a conditional UPDATE is atomic, and the unique keys are enforced. It
 * deliberately inserts an await before every statement's critical section, so
 * a regression from one conditional UPDATE back to a read-then-write pair
 * loses the concurrency test.
 */

type Row = Record<string, unknown>;
type Err = { message: string } | null;

const TOKEN = "O5d55d2922ca4021382";
const NONCE = "nonce-for-tests_AAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const USER = "11111111-1111-1111-1111-111111111111";

const state = vi.hoisted(() => {
  process.env.PAYMENT_PROVIDER = "tranzila";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
  process.env.TRANZILA_TERMINAL = "friendinv";
  process.env.TRANZILA_PASSWORD = "pw";
  process.env.NEXT_PUBLIC_APP_URL = "https://friendlyinvoice.co.il";
  return {
    tables: {} as Record<string, Row[]>,
    appMeta: {} as Record<string, Row>,
    users: {} as Record<string, boolean>,
    /** Forces both concurrent calls to interleave before their write. */
    stagger: false,
    /** How many times a plan was activated. Must be 1 per real checkout. */
    metaWrites: 0,
  };
});

// Unique keys the migrations create, so a double credit is caught here the way
// Postgres would catch it.
const UNIQUE_KEYS: Record<string, string[][]> = {
  subscription_charge_log: [
    ["user_id", "period_start"],
    ["provider", "transaction_id"],
  ],
  payment_checkout_intents: [["nonce"]],
};

function violatesUnique(table: string, rows: Row[], candidate: Row): boolean {
  for (const key of UNIQUE_KEYS[table] ?? []) {
    if (key.some((k) => candidate[k] == null)) continue;
    if (rows.some((r) => key.every((k) => r[k] === candidate[k]))) return true;
  }
  return false;
}

vi.mock("@supabase/supabase-js", () => {
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: USER, email: "sub@example.com", app_metadata: state.appMeta[USER] || {}, user_metadata: {} } },
        error: null,
      }),
      admin: {
        getUserById: async (id: string) => ({
          data: state.users[id]
            ? { user: { id, email: "sub@example.com", app_metadata: state.appMeta[id] || {} } }
            : { user: null },
          error: null,
        }),
        updateUserById: async (id: string, attrs: { app_metadata?: Row }) => {
          state.metaWrites += 1;
          state.appMeta[id] = { ...(attrs.app_metadata || {}) };
          return { data: { user: { id } }, error: null };
        },
      },
    },
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "update" | "upsert" = "select";
      let payload: Row = {};
      let conflictKey: string | null = null;

      const exec = async (): Promise<{ data: Row[]; error: Err }> => {
        // Every statement yields BEFORE it reads, so two in-flight callers
        // genuinely interleave; the critical section itself is synchronous,
        // which is what a single conditional UPDATE gets from Postgres.
        if (state.stagger) await new Promise((r) => setTimeout(r, 1));
        const rows = (state.tables[table] ??= []);
        const match = (r: Row) => filters.every((f) => f(r));
        if (op === "insert") {
          if (violatesUnique(table, rows, payload)) {
            return { data: [], error: { message: "duplicate key value violates unique constraint" } };
          }
          rows.push({ ...payload });
          return { data: [{ ...payload }], error: null };
        }
        if (op === "update") {
          const hit = rows.filter(match);
          hit.forEach((r) => Object.assign(r, payload));
          return { data: hit.map((r) => ({ ...r })), error: null };
        }
        if (op === "upsert") {
          const key = conflictKey || "id";
          const existing = rows.find((r) => r[key] === payload[key]);
          if (existing) Object.assign(existing, payload);
          else rows.push({ ...payload });
          return { data: [{ ...payload }], error: null };
        }
        return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
      };

      const q = {
        select() { return q; },
        insert(p: Row) { op = "insert"; payload = p; return q; },
        update(p: Row) { op = "update"; payload = p; return q; },
        upsert(p: Row, o?: { onConflict?: string }) { op = "upsert"; payload = p; conflictKey = o?.onConflict ?? null; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        gt(k: string, v: unknown) { filters.push((r) => String(r[k]) > String(v)); return q; },
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

import { POST as notifyPost } from "@/app/api/tranzila/notify/route";
import { POST as callbackPost } from "@/app/api/tranzila/callback/route";
import { POST as checkoutPost } from "@/app/api/billing/checkout/route";
import { consumeCheckoutIntent, mintCheckoutNonce } from "@/lib/tranzila-activation";
import { createClient } from "@supabase/supabase-js";

const NOTIFY_URL = `https://friendlyinvoice.co.il/api/tranzila/notify?n=${encodeURIComponent(NONCE)}`;

function pendingIntent(over: Row = {}): Row {
  return {
    id: "intent-1",
    nonce: NONCE,
    user_id: USER,
    provider: "tranzila",
    tier: "pro",
    interval: "month",
    expected_amount: "25.00",
    token_only: false,
    status: "pending",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

/** A real DirectNG success payload, field for field, plus the expiry fields a
 * real 2026-09-23 capture returned. */
function payload(over: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    supplier: "friendinv",
    sum: "25",
    currency: "1",
    Response: "000",
    contact: "Test Payer",
    email: "sub@example.com",
    transaction_id: "15009",
    index: "15009",
    ccno: "4207",
    cardtype: "2",
    TranzilaTK: TOKEN,
    expmonth: "11",
    expyear: "29",
    tranmode: "A",
    ...over,
  });
}

function notifyRequest(url = NOTIFY_URL, body = payload()): Request {
  return new Request(url, { method: "POST", body });
}

beforeEach(() => {
  state.tables = {};
  state.appMeta = {};
  state.users = { [USER]: true };
  state.stagger = false;
  state.metaWrites = 0;
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const subs = () => state.tables.subscriptions ?? [];
const charges = () => state.tables.subscription_charge_log ?? [];
const intents = () => state.tables.payment_checkout_intents ?? [];

describe("tranzila notify: a verified capture", () => {
  it("stores the token in subscriptions and activates the plan", async () => {
    state.tables.payment_checkout_intents = [pendingIntent()];

    const res = await notifyPost(notifyRequest());
    expect(res.status).toBe(200);

    expect(subs()).toHaveLength(1);
    const row = subs()[0];
    expect(row.user_id).toBe(USER);
    expect(row.provider).toBe("tranzila");
    expect(row.provider_token).toBe(TOKEN);
    // The expiry the token does NOT carry, captured alongside it.
    expect(row.card_exp_month).toBe(11);
    expect(row.card_exp_year).toBe(2029);
    expect(row.card_last4).toBe("4207");
    expect(row.provider_terminal).toBe("friendinv");
    expect(row.status).toBe("active");
    expect(row.cancel_at_period_end).toBe(false);

    expect(state.appMeta[USER].plan_active).toBe(true);
    expect(state.appMeta[USER].plan_tier).toBe("pro");
    expect(state.appMeta[USER].payment_provider).toBe("tranzila");
    expect(intents()[0].status).toBe("consumed");
  });

  it("never puts the token, the PAN or the nonce in app_metadata or the response", async () => {
    state.tables.payment_checkout_intents = [pendingIntent()];

    const res = await notifyPost(notifyRequest());
    const body = await res.text();

    // app_metadata is readable by the signed-in client (the billing page is a
    // client component), so a reusable card token in there is a chargeable
    // credential handed to the browser. This is the whole reason the Grow
    // precedent was not copied.
    const meta = JSON.stringify(state.appMeta[USER]);
    expect(meta).not.toContain(TOKEN);
    expect(meta).not.toContain(NONCE);
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain(NONCE);
  });

  it("records the capture in the charge log with the transaction id", async () => {
    state.tables.payment_checkout_intents = [pendingIntent()];
    await notifyPost(notifyRequest());

    expect(charges()).toHaveLength(1);
    expect(charges()[0]).toMatchObject({
      user_id: USER,
      provider: "tranzila",
      transaction_id: "15009",
      amount: 25,
      success: true,
    });
  });

  it("treats a token-only (trial) checkout as a trial start with no charge logged", async () => {
    state.tables.payment_checkout_intents = [
      pendingIntent({ token_only: true, expected_amount: "1.00" }),
    ];

    await notifyPost(notifyRequest(NOTIFY_URL, payload({ sum: "1", tranmode: "N" })));

    expect(charges()).toHaveLength(0);
    expect(state.appMeta[USER].plan_trialing).toBe(true);
    expect(subs()[0].provider_token).toBe(TOKEN);
  });

  it("takes tier and interval from the intent, never from the payload", async () => {
    state.tables.payment_checkout_intents = [
      pendingIntent({ tier: "free", interval: "year", expected_amount: "149.00" }),
    ];

    // The POST body claims something else entirely; it must be ignored.
    await notifyPost(
      notifyRequest(NOTIFY_URL, payload({ sum: "149", pdesc: "tier=pro&interval=month" })),
    );

    expect(subs()[0].tier).toBe("free");
    expect(subs()[0].interval).toBe("year");
    expect(state.appMeta[USER].plan_tier).toBe("free");
  });
});

describe("tranzila notify: everything that must NOT write", () => {
  it("ignores a replayed nonce - the second POST changes nothing", async () => {
    state.tables.payment_checkout_intents = [pendingIntent()];

    await notifyPost(notifyRequest());
    const metaAfterFirst = JSON.stringify(state.appMeta[USER]);

    const second = await notifyPost(notifyRequest());
    expect(second.status).toBe(200);

    expect(subs()).toHaveLength(1);
    expect(charges()).toHaveLength(1);
    expect(JSON.stringify(state.appMeta[USER])).toBe(metaAfterFirst);
    // Not "the second write happened to be identical": it never happened.
    expect(state.metaWrites).toBe(1);
  });

  it("ignores a nonce that was never minted", async () => {
    const res = await notifyPost(
      notifyRequest("https://friendlyinvoice.co.il/api/tranzila/notify?n=never-minted-nonce-000000"),
    );

    expect(res.status).toBe(200);
    expect(subs()).toHaveLength(0);
    expect(charges()).toHaveLength(0);
    expect(state.appMeta[USER]).toBeUndefined();
  });

  it("ignores a result with no nonce at all", async () => {
    state.tables.payment_checkout_intents = [pendingIntent()];

    await notifyPost(notifyRequest("https://friendlyinvoice.co.il/api/tranzila/notify"));

    expect(subs()).toHaveLength(0);
    expect(intents()[0].status).toBe("pending");
  });

  it("ignores an expired intent", async () => {
    state.tables.payment_checkout_intents = [
      pendingIntent({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    ];

    await notifyPost(notifyRequest());

    expect(subs()).toHaveLength(0);
    expect(intents()[0].status).toBe("pending");
  });

  it("leaves the intent PENDING on a declined result, so a retry can still succeed", async () => {
    state.tables.payment_checkout_intents = [pendingIntent()];

    await notifyPost(notifyRequest(NOTIFY_URL, payload({ Response: "004" })));

    expect(intents()[0].status).toBe("pending");
    expect(subs()).toHaveLength(0);

    // ...and the customer's retry on the same hosted page then works.
    await notifyPost(notifyRequest());
    expect(subs()).toHaveLength(1);
  });

  it("writes nothing when the echoed sum is not the sum we asked for", async () => {
    state.tables.payment_checkout_intents = [pendingIntent()];

    await notifyPost(notifyRequest(NOTIFY_URL, payload({ sum: "1" })));

    expect(subs()).toHaveLength(0);
    expect(charges()).toHaveLength(0);
    expect(state.appMeta[USER]).toBeUndefined();
    // The nonce is burned anyway: fail closed, do not offer a second guess.
    expect(intents()[0].status).toBe("consumed");
  });
});

describe("tranzila notify: concurrency", () => {
  it("consumes the intent exactly once when two notifies land together", async () => {
    state.tables.payment_checkout_intents = [pendingIntent()];
    state.stagger = true;

    const results = await Promise.all([notifyPost(notifyRequest()), notifyPost(notifyRequest())]);

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(intents().filter((i) => i.status === "consumed")).toHaveLength(1);
    // One subscription, and above all ONE charge credited. metaWrites is the
    // sharp assertion: a read-then-write consumption would let BOTH callers
    // activate, and only the database's unique keys would (silently) absorb
    // the second one.
    expect(state.metaWrites).toBe(1);
    expect(subs()).toHaveLength(1);
    expect(charges()).toHaveLength(1);
  });

  it("consumeCheckoutIntent hands the row to exactly one of two racing callers", async () => {
    state.tables.payment_checkout_intents = [pendingIntent()];
    state.stagger = true;
    const admin = createClient("https://test.supabase.co", "test-service");

    const [a, b] = await Promise.all([
      consumeCheckoutIntent(admin, NONCE, { index: "1", transactionId: "1" }),
      consumeCheckoutIntent(admin, NONCE, { index: "1", transactionId: "1" }),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe("tranzila browser callback", () => {
  it("writes nothing and sends the customer back to /billing", async () => {
    state.tables.payment_checkout_intents = [pendingIntent()];

    const res = await callbackPost(
      new Request("https://friendlyinvoice.co.il/api/tranzila/callback", {
        method: "POST",
        body: payload(),
      }),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/billing?success=1");
    // The browser leg is an observer: the token it carried changed nothing.
    expect(subs()).toHaveLength(0);
    expect(intents()[0].status).toBe("pending");
  });

  it("sends a failed capture to the canceled landing", async () => {
    const res = await callbackPost(
      new Request("https://friendlyinvoice.co.il/api/tranzila/callback?status=failed", {
        method: "POST",
        body: payload({ Response: "004" }),
      }),
    );

    expect(res.headers.get("location")).toBe("/billing?canceled=1");
  });
});

describe("tranzila checkout", () => {
  it("mints an intent and puts the nonce on the notify URL only", async () => {
    const res = await checkoutPost(
      new Request("https://friendlyinvoice.co.il/api/billing/checkout", {
        method: "POST",
        headers: { Authorization: "Bearer session-token", "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "pro", interval: "month" }),
      }) as never,
    );

    const body = (await res.json()) as { ok: boolean; url: string };
    expect(body.ok).toBe(true);

    expect(intents()).toHaveLength(1);
    const intent = intents()[0];
    expect(intent.user_id).toBe(USER);
    expect(intent.status).toBe("pending");
    // A first-time subscriber gets the ₪1 card check, not a real charge.
    expect(intent.token_only).toBe(true);
    expect(intent.expected_amount).toBe(1);

    const params = new URL(body.url).searchParams;
    const nonce = String(intent.nonce);
    expect(params.get("notify_url_address")).toContain(encodeURIComponent(nonce));
    // THE point: the customer's own URLs carry no authenticator.
    expect(params.get("success_url_address")).toBe(
      "https://friendlyinvoice.co.il/api/tranzila/callback",
    );
    expect(params.get("success_url_address")).not.toContain(nonce);
    expect(params.get("fail_url_address")).not.toContain(nonce);
  });
});

describe("mintCheckoutNonce", () => {
  it("is long, url-safe and never repeats", () => {
    const a = mintCheckoutNonce();
    const b = mintCheckoutNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(encodeURIComponent(a)).toBe(a);
  });
});

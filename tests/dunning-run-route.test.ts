import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The dunning cron against an in-memory Supabase and a fake mail server:
// proves the stage is claimed in dunning_log BEFORE the email goes out, that a
// failed claim sends nothing, that a failed send releases the claim, and that
// the query plus planner never email a quote.

type Row = Record<string, unknown>;
type Err = { message: string } | null;

const state = vi.hoisted(() => {
  process.env.DUNNING_CRON_SECRET = "cron-secret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.GMAIL_USER = "app@example.com";
  process.env.GMAIL_APP_PASSWORD = "pass word";
  return {
    tables: {} as Record<string, Row[]>,
    events: [] as string[],
    failInsert: null as Err,
    failSend: false,
    sent: [] as Array<{ to: string; subject: string; text: string }>,
  };
});

vi.mock("@/lib/notifications-server", () => ({
  createNotificationForBusiness: vi.fn(async () => true),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: { to: string; subject: string; text: string }) => {
        state.events.push(`send:${m.to}`);
        if (state.failSend) throw new Error("smtp down");
        state.sent.push(m);
        return {};
      },
    }),
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email_confirmed_at: "2026-01-01" } }, error: null }),
      },
    },
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row = {};
      const q = {
        select() { return q; },
        or() { return q; },
        insert(row: Row) { op = "insert"; payload = row; return q; },
        update(row: Row) { op = "update"; payload = row; return q; },
        delete() { op = "delete"; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return q; },
        in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return q; },
        then(resolve: (v: { data: unknown; error: Err }) => void) {
          const rows = (state.tables[table] ??= []);
          const match = (r: Row) => filters.every((f) => f(r));
          if (op === "insert") {
            state.events.push(`insert:${table}`);
            if (state.failInsert) return Promise.resolve(resolve({ data: null, error: state.failInsert }));
            const dup = rows.some(
              (r) =>
                r.document_id === payload.document_id &&
                r.day_bucket === payload.day_bucket &&
                r.channel === payload.channel,
            );
            if (dup) return Promise.resolve(resolve({ data: null, error: { message: "duplicate key" } }));
            rows.push({ ...payload });
            return Promise.resolve(resolve({ data: null, error: null }));
          }
          if (op === "update") {
            state.events.push(`update:${table}`);
            rows.filter(match).forEach((r) => Object.assign(r, payload));
            return Promise.resolve(resolve({ data: null, error: null }));
          }
          if (op === "delete") {
            state.events.push(`delete:${table}`);
            state.tables[table] = rows.filter((r) => !match(r));
            return Promise.resolve(resolve({ data: null, error: null }));
          }
          return Promise.resolve(resolve({ data: rows.filter(match), error: null }));
        },
      };
      return q;
    },
  }),
}));

import { POST } from "@/app/api/dunning/run/route";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function docRow(over: Row = {}): Row {
  return {
    id: "doc-1",
    business_id: "b1",
    client_id: "cl-1",
    client_name: "דני",
    number: 12,
    date: isoDaysAgo(5),
    total: 3600,
    currency: "ILS",
    type: "tax_invoice",
    status: "sent",
    paid_at: null,
    converted_to_id: null,
    ...over,
  };
}

function run() {
  return POST(
    new NextRequest("http://localhost/api/dunning/run", {
      method: "POST",
      headers: { "x-cron-secret": "cron-secret" },
    }),
  );
}

beforeEach(() => {
  state.tables = {
    businesses: [
      {
        id: "b1",
        name: "עסק",
        dunning_enabled: true,
        // Assisted pass off so only the email pass writes to dunning_log.
        dunning_whatsapp_enabled: false,
        dunning_from_name: null,
        email: "owner@example.com",
        user_id: "u1",
      },
    ],
    clients: [{ id: "cl-1", email: "client@example.com", phone: null }],
    documents: [],
    dunning_log: [],
  };
  state.events = [];
  state.failInsert = null;
  state.failSend = false;
  state.sent = [];
});

describe("dunning run: email pass", () => {
  it("claims the stage in dunning_log before sending, then marks it successful", async () => {
    state.tables.documents = [docRow()];
    const body = await (await run()).json();
    expect(body.sent).toBe(1);
    const insertAt = state.events.indexOf("insert:dunning_log");
    const sendAt = state.events.indexOf("send:client@example.com");
    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(sendAt).toBeGreaterThan(insertAt);
    expect(state.tables.dunning_log).toEqual([
      expect.objectContaining({ document_id: "doc-1", day_bucket: 3, channel: "email", success: true }),
    ]);
  });

  it("sends nothing when the claim insert fails, and says so", async () => {
    state.tables.documents = [docRow()];
    state.failInsert = { message: "db unavailable" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await (await run()).json();
    expect(state.sent).toHaveLength(0);
    expect(body.sent).toBe(0);
    expect(body.errors).toBe(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never sends the same stage twice across runs", async () => {
    state.tables.documents = [docRow()];
    await run();
    const second = await (await run()).json();
    expect(state.sent).toHaveLength(1);
    expect(second.sent).toBe(0);
  });

  it("releases the claim when the send fails, so the next run retries", async () => {
    state.tables.documents = [docRow()];
    state.failSend = true;
    const failed = await (await run()).json();
    expect(failed.errors).toBe(1);
    expect(state.tables.dunning_log).toHaveLength(0);
    state.failSend = false;
    const retried = await (await run()).json();
    expect(retried.sent).toBe(1);
  });

  it("never emails a quote or a converted document", async () => {
    state.tables.documents = [
      docRow({ id: "quote", type: "quote" }),
      docRow({ id: "converted", converted_to_id: "doc-9" }),
    ];
    const body = await (await run()).json();
    expect(body.sent).toBe(0);
    expect(state.sent).toHaveLength(0);
  });

  it("emails a USD proforma in dollars, with the right noun and an Israeli date", async () => {
    const date = isoDaysAgo(5);
    state.tables.documents = [docRow({ type: "proforma", currency: "USD" })];
    await run();
    expect(state.sent).toHaveLength(1);
    const [mail] = state.sent;
    expect(mail.subject).toBe("תזכורת: חשבון עסקה מספר 12");
    expect(mail.text).toContain("$3,600.00");
    expect(mail.text).not.toContain("₪");
    expect(mail.text).not.toContain("חשבונית");
    const [y, m, d] = date.split("-");
    expect(mail.text).toContain(`${d}.${m}.${y}`);
    expect(mail.text).not.toContain(date);
  });
});

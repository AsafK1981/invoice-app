import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// The dunning cron with documents that state a due date: the query asks for
// due_date, nothing goes out before it has passed (and that is not reported
// as a missing client email), and once it has, the email names the due date.

type Row = Record<string, unknown>;

const state = vi.hoisted(() => {
  process.env.DUNNING_CRON_SECRET = "cron-secret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.GMAIL_USER = "app@example.com";
  process.env.GMAIL_APP_PASSWORD = "pass word";
  return {
    tables: {} as Record<string, Row[]>,
    selects: {} as Record<string, string>,
    sent: [] as Array<{ to: string; subject: string; text: string }>,
    notifications: [] as Array<Record<string, unknown>>,
  };
});

vi.mock("@/lib/notifications-server", () => ({
  createNotificationForBusiness: vi.fn(async (n: Record<string, unknown>) => {
    state.notifications.push(n);
    return true;
  }),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: { to: string; subject: string; text: string }) => {
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
        select(cols: string) { state.selects[table] = cols; return q; },
        or() { return q; },
        insert(row: Row) { op = "insert"; payload = row; return q; },
        update(row: Row) { op = "update"; payload = row; return q; },
        delete() { op = "delete"; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return q; },
        in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return q; },
        lt() { return q; },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          const rows = (state.tables[table] ??= []);
          const match = (r: Row) => filters.every((f) => f(r));
          if (op === "insert") rows.push({ ...payload });
          else if (op === "update") rows.filter(match).forEach((r) => Object.assign(r, payload));
          else if (op === "delete") state.tables[table] = rows.filter((r) => !match(r));
          else return Promise.resolve(resolve({ data: rows.filter(match), error: null }));
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };
      return q;
    },
  }),
}));

import { POST } from "@/app/api/dunning/run/route";

const NOW = new Date(2026, 8, 16, 10, 0);

function doc(over: Row): Row {
  return {
    id: "doc-1",
    business_id: "b1",
    client_id: "cl-1",
    client_name: "דני",
    number: 12,
    date: "2026-06-01",
    due_date: null,
    total: 3600,
    currency: "ILS",
    type: "tax_invoice",
    status: "sent",
    paid_at: null,
    converted_to_id: null,
    ...over,
  };
}

async function run() {
  const res = await POST(
    new NextRequest("http://localhost/api/dunning/run", {
      method: "POST",
      headers: { "x-cron-secret": "cron-secret" },
    }),
  );
  return res.json();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.tables = {
    businesses: [
      {
        id: "b1",
        name: "עסק",
        dunning_enabled: true,
        dunning_whatsapp_enabled: true,
        dunning_from_name: null,
        email: "owner@example.com",
        user_id: "u1",
      },
    ],
    clients: [
      { id: "cl-1", email: "client@example.com", phone: "054-900-0684" },
      { id: "cl-2", email: null, phone: "054-900-0684" },
    ],
    documents: [],
    dunning_log: [],
  };
  state.selects = {};
  state.sent = [];
  state.notifications = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dunning run with due dates", () => {
  it("selects due_date with the documents", async () => {
    await run();
    expect(state.selects.documents.split(",").map((c) => c.trim())).toContain("due_date");
  });

  it("sends and prepares nothing before the due date has passed, and reports no missing email", async () => {
    state.tables.documents = [
      // Issued 107 days ago, so the issue-date schedule would be at stage 30.
      doc({ id: "future", due_date: "2026-09-30" }),
      doc({ id: "no-mail-future", client_id: "cl-2", due_date: "2026-09-20" }),
      doc({ id: "two-days", due_date: "2026-09-14" }),
    ];
    const body = await run();
    expect(body).toMatchObject({ sent: 0, prepared: 0, skipped: 3, errors: 0 });
    expect(body.details).toEqual([]);
    expect(state.sent).toEqual([]);
    expect(state.notifications).toEqual([]);
    expect(state.tables.dunning_log).toEqual([]);
  });

  it("emails stage 14 counted from the due date, naming it", async () => {
    state.tables.documents = [doc({ due_date: "2026-09-01" })];
    const body = await run();
    expect(body).toMatchObject({ sent: 1, prepared: 1, errors: 0 });
    const [mail] = state.sent;
    expect(mail.subject).toBe("תזכורת שנייה: חשבונית מספר 12");
    expect(mail.text).toContain(
      "אנחנו עוקבים אחרי חשבונית מספר 12 על סך ⁦₪ 3,600⁩. מועד התשלום היה ב-01.09.2026, וחלפו מאז 15 ימים ולא ראינו את התשלום.",
    );
    expect(mail.text).not.toContain("2026-09-01");
    expect(state.tables.dunning_log).toEqual([
      expect.objectContaining({ document_id: "doc-1", day_bucket: 14, channel: "email", success: true }),
      expect.objectContaining({ document_id: "doc-1", day_bucket: 14, channel: "whatsapp_assist" }),
    ]);
    const wa = state.notifications.find((n) => n.kind === "whatsapp_reminder_ready");
    expect(wa).toMatchObject({ title: "חשבונית מס #12 של דני: 15 ימים בלי תשלום" });
  });

  it("still reports a past-due document whose client has no email", async () => {
    state.tables.documents = [doc({ client_id: "cl-2", due_date: "2026-09-10" })];
    const body = await run();
    expect(body.details).toEqual([{ doc: "doc-1", bucket: 3, outcome: "no client email" }, expect.objectContaining({ outcome: "whatsapp reminder prepared" })]);
  });
});

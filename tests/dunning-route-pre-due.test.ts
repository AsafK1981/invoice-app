import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// The dunning cron with the friendly pre-due email: opt-in on top of the email
// pass, claimed before it is sent exactly like a stage email, sent once, with
// no owner notification, and independent of the later stage 3 email.
//
// The in-memory Supabase below enforces the UNIQUE key but NOT the day_bucket
// CHECK, which is why 20260916-dunning-pre-due.sql must be applied before the
// code ships: no test here can catch a database that still rejects -5.

type Row = Record<string, unknown>;
type Err = { message: string } | null;

const state = vi.hoisted(() => {
  process.env.DUNNING_CRON_SECRET = "cron-secret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.GMAIL_USER = "app@example.com";
  process.env.GMAIL_APP_PASSWORD = "pass word";
  return {
    tables: {} as Record<string, Row[]>,
    selects: {} as Record<string, string>,
    events: [] as string[],
    failInsert: null as Err,
    failSend: false,
    sent: [] as Array<{ from: string; to: string; replyTo: string; subject: string; text: string; html: string; headers: Record<string, string> }>,
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
      sendMail: async (m: (typeof state.sent)[number]) => {
        state.events.push(`send:${m.subject}`);
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
        select(cols: string) { state.selects[table] = cols; return q; },
        or() { return q; },
        insert(row: Row) { op = "insert"; payload = row; return q; },
        update(row: Row) { op = "update"; payload = row; return q; },
        delete() { op = "delete"; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return q; },
        in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return q; },
        lt() { return q; },
        then(resolve: (v: { data: unknown; error: Err }) => void) {
          const rows = (state.tables[table] ??= []);
          const match = (r: Row) => filters.every((f) => f(r));
          if (op === "insert") {
            state.events.push(`insert:${table}:${payload.day_bucket}`);
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
import { PRE_DUE_BUCKET } from "@/lib/dunning-copy";
import { CANONICAL_ORIGIN } from "@/lib/public-url";

const SHEKEL_3600 = `${String.fromCharCode(0x2066, 0x20aa, 0x202f)}3,600${String.fromCharCode(0x2069)}`;
const NOW = new Date(2026, 8, 16, 10, 0);
const PRE_DUE_SUBJECT = "תזכורת ידידותית: חשבונית מספר 12";

function doc(over: Row = {}): Row {
  return {
    id: "doc-1",
    business_id: "b1",
    client_id: "cl-1",
    client_name: "דני",
    number: 12,
    date: "2026-09-01",
    due_date: "2026-09-19", // 3 days after NOW
    total: 3600,
    currency: "ILS",
    type: "tax_invoice",
    status: "sent",
    paid_at: null,
    converted_to_id: null,
    ...over,
  };
}

function business(over: Row = {}): Row {
  return {
    id: "b1",
    name: "עסק",
    dunning_enabled: true,
    dunning_whatsapp_enabled: false,
    dunning_pre_due_enabled: true,
    dunning_from_name: null,
    email: "owner@example.com",
    user_id: "u1",
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
    businesses: [business()],
    clients: [
      { id: "cl-1", email: "client@example.com", phone: "054-900-0684" },
      { id: "cl-2", email: null, phone: "054-900-0684" },
    ],
    documents: [doc()],
    dunning_log: [],
  };
  state.selects = {};
  state.events = [];
  state.failInsert = null;
  state.failSend = false;
  state.sent = [];
  state.notifications = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dunning run: friendly pre-due email", () => {
  it("selects the setting with the business", async () => {
    await run();
    expect(state.selects.businesses.split(",").map((c) => c.trim())).toContain("dunning_pre_due_enabled");
  });

  it("emails the client once, in the stage emails' layout, with no owner notification", async () => {
    const body = await run();
    expect(body).toMatchObject({ sent: 1, prepared: 0, skipped: 1, errors: 0 });
    expect(body.details).toEqual([{ doc: "doc-1", bucket: PRE_DUE_BUCKET, outcome: "sent" }]);
    expect(state.sent).toHaveLength(1);
    const [mail] = state.sent;
    expect(mail.from).toBe('"עסק" <app@example.com>');
    expect(mail.to).toBe("client@example.com");
    expect(mail.replyTo).toBe("owner@example.com");
    expect(mail.headers).toEqual({ "X-Auto-Response-Suppress": "All", "Auto-Submitted": "auto-generated" });
    expect(mail.subject).toBe(PRE_DUE_SUBJECT);
    expect(mail.text).toBe(
      `שלום דני,\n\nרצינו להזכיר שמועד התשלום של חשבונית המס מספר 12 על סך ${SHEKEL_3600} הוא ב-19.09.2026.\n\n` +
        `כל פרטי התשלום נמצאים בחשבונית. אם כבר שילמתם, אפשר להתעלם מההודעה.\n\n` +
        `לצפייה במסמך:\n${CANONICAL_ORIGIN}/view/doc-1\n\nתודה רבה,\nעסק\n`,
    );
    expect(mail.html).toContain('<html lang="he" dir="rtl">');
    expect(mail.html).toContain("רצינו להזכיר שמועד התשלום של חשבונית המס מספר 12");
    expect(mail.html).toContain(`href="${CANONICAL_ORIGIN}/view/doc-1"`);
    expect(mail.html).toContain("תזכורת אוטומטית. אם התשלום כבר בוצע ולא הגיע, נשמח לשמוע.");
    expect(state.notifications).toEqual([]);
    expect(state.tables.dunning_log).toEqual([
      expect.objectContaining({
        document_id: "doc-1",
        business_id: "b1",
        day_bucket: PRE_DUE_BUCKET,
        sent_to: "client@example.com",
        channel: "email",
        success: true,
      }),
    ]);
  });

  it("uses the custom From name like the stage emails", async () => {
    state.tables.businesses = [business({ dunning_from_name: "דני בע\"מ" })];
    await run();
    expect(state.sent[0].from).toBe('"דני בע"מ" <app@example.com>');
  });

  it("renders a pro forma with its own noun", async () => {
    state.tables.documents = [doc({ type: "proforma" })];
    await run();
    const [mail] = state.sent;
    expect(mail.subject).toBe("תזכורת ידידותית: חשבון עסקה מספר 12");
    expect(mail.text).toContain(
      `רצינו להזכיר שמועד התשלום של חשבון העסקה מספר 12 על סך ${SHEKEL_3600} הוא ב-19.09.2026.\n\nכל פרטי התשלום נמצאים בחשבון העסקה. אם כבר שילמתם, אפשר להתעלם מההודעה.`,
    );
    expect(mail.text).not.toContain("חשבונית");
  });

  it("sends nothing on the second run", async () => {
    await run();
    const second = await run();
    expect(second).toMatchObject({ sent: 0, errors: 0 });
    expect(state.sent).toHaveLength(1);
    expect(state.tables.dunning_log).toHaveLength(1);
  });

  it("claims before sending and confirms after", async () => {
    await run();
    expect(state.events).toEqual([
      "delete:dunning_log", // the stale-claim sweep
      `insert:dunning_log:${PRE_DUE_BUCKET}`,
      `send:${PRE_DUE_SUBJECT}`,
      "update:dunning_log",
    ]);
  });

  it("sends nothing when the claim fails", async () => {
    state.failInsert = { message: "new row violates check constraint" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await run();
    expect(body).toMatchObject({ sent: 0, errors: 1 });
    expect(body.details).toEqual([
      { doc: "doc-1", bucket: PRE_DUE_BUCKET, outcome: "error: dunning_log claim failed (new row violates check constraint)" },
    ]);
    expect(state.sent).toEqual([]);
    expect(state.events.some((e) => e.startsWith("send:"))).toBe(false);
    spy.mockRestore();
  });

  it("releases the claim when the send fails, and retries on the next run", async () => {
    state.failSend = true;
    const failed = await run();
    expect(failed).toMatchObject({ sent: 0, errors: 1 });
    expect(state.tables.dunning_log).toEqual([]);
    state.failSend = false;
    const retried = await run();
    expect(retried.sent).toBe(1);
    expect(state.tables.dunning_log).toEqual([
      expect.objectContaining({ day_bucket: PRE_DUE_BUCKET, success: true }),
    ]);
  });

  it("is independent of the stage 3 email that follows once the date passes", async () => {
    await run();
    vi.setSystemTime(new Date(2026, 8, 22, 10, 0)); // 3 days past 19.09
    const later = await run();
    expect(later).toMatchObject({ sent: 1, errors: 0 });
    expect(state.sent.map((m) => m.subject)).toEqual([PRE_DUE_SUBJECT, "תזכורת: חשבונית מספר 12"]);
    expect(state.tables.dunning_log.map((r) => [r.day_bucket, r.channel, r.success])).toEqual([
      [PRE_DUE_BUCKET, "email", true],
      [3, "email", true],
    ]);
    // The stage email keeps its owner notification.
    expect(state.notifications.map((n) => n.kind)).toEqual(["dunning_sent"]);
  });

  it("does not fire outside the window or under the 7-day term", async () => {
    state.tables.documents = [
      doc({ id: "six", due_date: "2026-09-22" }),
      doc({ id: "today", due_date: "2026-09-16" }),
      doc({ id: "short-term", date: "2026-09-13", due_date: "2026-09-19" }),
      // Issued yesterday, so no issue-date stage either.
      doc({ id: "no-due", date: "2026-09-15", due_date: null }),
      doc({ id: "no-mail", client_id: "cl-2" }),
      doc({ id: "quote", type: "quote" }),
    ];
    const body = await run();
    expect(body).toMatchObject({ sent: 0, errors: 0 });
    expect(body.details).toEqual([]);
    expect(state.tables.dunning_log).toEqual([]);
  });
});

describe("dunning run: the pre-due email stays off unless both switches are on", () => {
  for (const [name, over] of [
    ["setting false", { dunning_pre_due_enabled: false }],
    ["setting missing (column not selected yet)", { dunning_pre_due_enabled: undefined }],
    ["setting null", { dunning_pre_due_enabled: null }],
    ["email pass off", { dunning_enabled: false, dunning_whatsapp_enabled: true }],
  ] as const) {
    it(`${name}: exactly today's run for due-dated documents`, async () => {
      state.tables.businesses = [business({ dunning_whatsapp_enabled: true, ...over })];
      state.tables.documents = [
        doc({ id: "soon" }), // due in 3 days
        doc({ id: "late", due_date: "2026-09-01" }), // stage 14
      ];
      const body = await run();
      const emailOn = over.dunning_enabled !== false;
      expect(body).toMatchObject({ sent: emailOn ? 1 : 0, prepared: 1, skipped: emailOn ? 1 : 0, errors: 0 });
      expect(state.sent.map((m) => m.subject)).toEqual(emailOn ? ["תזכורת שנייה: חשבונית מספר 12"] : []);
      expect(state.tables.dunning_log.some((r) => r.day_bucket === PRE_DUE_BUCKET)).toBe(false);
      expect(state.tables.dunning_log.every((r) => r.document_id === "late")).toBe(true);
    });
  }
});

import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Byte-for-byte pins for a document WITH a due date that its client can see
// (due_date_hidden false or not selected). Written against the code before
// hidden due dates changed the wording, and kept green after: a document that
// prints its "לתשלום עד" must keep getting exactly these reminders.
// The hidden case lives in due-date-hidden.test.ts.

type Row = Record<string, unknown>;

const state = vi.hoisted(() => {
  process.env.DUNNING_CRON_SECRET = "cron-secret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.GMAIL_USER = "app@example.com";
  process.env.GMAIL_APP_PASSWORD = "pass word";
  return {
    tables: {} as Record<string, Row[]>,
    sent: [] as Array<{ to: string; subject: string; text: string; html: string }>,
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
      sendMail: async (m: { to: string; subject: string; text: string; html: string }) => {
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
import { dunningEmailContent, preDueEmailContent, whatsappReminderText, type DunningStage } from "@/lib/dunning-copy";
import { planPreDueEmails } from "@/lib/dunning-plan";
import { CANONICAL_ORIGIN } from "@/lib/public-url";

const SHEKEL_3600 = `${String.fromCharCode(0x2066, 0x20aa, 0x202f)}3,600${String.fromCharCode(0x2069)}`;

/* ------------------------------------------------------------------ */
/* copy                                                                */
/* ------------------------------------------------------------------ */

const EMAIL_PINS: Record<string, { subject: string; intro: string; cta: string; signoff: string }> = {
  "tax_invoice:3": {
    subject: "תזכורת: חשבונית מספר 12",
    intro: `רק רציתי לוודא שראיתם את חשבונית המס מספר 12 על סך ${SHEKEL_3600}. מועד התשלום היה ב-20.07.2026.`,
    cta: "אם נוח לכם, אשמח לסגור את התשלום. כל פרטי התשלום נמצאים בחשבונית.",
    signoff: "תודה רבה,",
  },
  "tax_invoice:14": {
    subject: "תזכורת שנייה: חשבונית מספר 12",
    intro: `אנחנו עוקבים אחרי חשבונית מספר 12 על סך ${SHEKEL_3600}. מועד התשלום היה ב-20.07.2026, וחלפו מאז 16 ימים ולא ראינו את התשלום.`,
    cta: "אשמח לקבל עדכון: האם התשלום בוצע ולא הגיע, או שעדיין מתעכב?",
    signoff: "תודה,",
  },
  "tax_invoice:30": {
    subject: "חשבונית מספר 12: תשלום מתעכב",
    intro: `חשבונית מספר 12 על סך ${SHEKEL_3600} עדיין לא שולמה. מועד התשלום היה ב-20.07.2026, וחלפו מאז 32 ימים.`,
    cta: "אנא תאמו אתנו תאריך תשלום בהקדם. אם יש בעיה או שאלה, נשמח לסייע.",
    signoff: "בכבוד רב,",
  },
  "proforma:3": {
    subject: "תזכורת: חשבון עסקה מספר 12",
    intro: `רק רציתי לוודא שראיתם את חשבון העסקה מספר 12 על סך ${SHEKEL_3600}. מועד התשלום היה ב-20.07.2026.`,
    cta: "אם נוח לכם, אשמח לסגור את התשלום. כל פרטי התשלום נמצאים בחשבון העסקה.",
    signoff: "תודה רבה,",
  },
  "proforma:14": {
    subject: "תזכורת שנייה: חשבון עסקה מספר 12",
    intro: `אנחנו עוקבים אחרי חשבון עסקה מספר 12 על סך ${SHEKEL_3600}. מועד התשלום היה ב-20.07.2026, וחלפו מאז 16 ימים ולא ראינו את התשלום.`,
    cta: "אשמח לקבל עדכון: האם התשלום בוצע ולא הגיע, או שעדיין מתעכב?",
    signoff: "תודה,",
  },
  "proforma:30": {
    subject: "חשבון עסקה מספר 12: תשלום מתעכב",
    intro: `חשבון עסקה מספר 12 על סך ${SHEKEL_3600} עדיין לא שולם. מועד התשלום היה ב-20.07.2026, וחלפו מאז 32 ימים.`,
    cta: "אנא תאמו אתנו תאריך תשלום בהקדם. אם יש בעיה או שאלה, נשמח לסייע.",
    signoff: "בכבוד רב,",
  },
};

const PRE_DUE_PINS: Record<string, { subject: string; intro: string; cta: string; signoff: string }> = {
  tax_invoice: {
    subject: "תזכורת ידידותית: חשבונית מספר 12",
    intro: `רצינו להזכיר שמועד התשלום של חשבונית המס מספר 12 על סך ${SHEKEL_3600} הוא ב-20.07.2026.`,
    cta: "כל פרטי התשלום נמצאים בחשבונית. אם כבר שילמתם, אפשר להתעלם מההודעה.",
    signoff: "תודה רבה,",
  },
  proforma: {
    subject: "תזכורת ידידותית: חשבון עסקה מספר 12",
    intro: `רצינו להזכיר שמועד התשלום של חשבון העסקה מספר 12 על סך ${SHEKEL_3600} הוא ב-20.07.2026.`,
    cta: "כל פרטי התשלום נמצאים בחשבון העסקה. אם כבר שילמתם, אפשר להתעלם מההודעה.",
    signoff: "תודה רבה,",
  },
};

const WA_TAIL = "\n\nלצפייה במסמך: https://friendlyinvoice.co.il/view/x\n\n";
const WA_PRE_CTA = "כל פרטי התשלום נמצאים במסמך. אם כבר שילמת, אפשר להתעלם מההודעה.";

function waPin(type: "tax_invoice" | "proforma", stage: DunningStage | null, days: number): string {
  const noun = type === "proforma" ? "חשבון העסקה" : "החשבונית";
  if (stage === null && days <= 0) {
    return `שלום לקוח,\n\nשלחתי לך את ${noun} מספר 12 על סך ${SHEKEL_3600} מ-05.07.2026, אשמח לתשלום עד 20.07.2026.\n\n${WA_PRE_CTA}${WA_TAIL}תודה,\nעסק`;
  }
  if (stage === null) {
    return `שלום לקוח,\n\nשלחתי לך את ${noun} מספר 12 על סך ${SHEKEL_3600} מ-05.07.2026, אשמח לתשלום.\n\n${WA_PRE_CTA}${WA_TAIL}תודה,\nעסק`;
  }
  const e = EMAIL_PINS[`${type}:${stage}`];
  return `שלום לקוח,\n\n${e.intro}\n\n${e.cta}${WA_TAIL}${e.signoff}\nעסק`;
}

describe("visible due date: reminder copy is unchanged", () => {
  for (const type of ["tax_invoice", "proforma"] as const) {
    for (const stage of [3, 14, 30] as const) {
      it(`email ${type} stage ${stage}`, () => {
        const args = { stage, docType: type, number: 12, total: 3600, date: "2026-07-05", dueDate: "2026-07-20", days: stage + 2 };
        expect(dunningEmailContent(args)).toEqual(EMAIL_PINS[`${type}:${stage}`]);
        expect(dunningEmailContent({ ...args, dueDateHidden: false })).toEqual(EMAIL_PINS[`${type}:${stage}`]);
        expect(dunningEmailContent({ ...args, dueDateHidden: null })).toEqual(EMAIL_PINS[`${type}:${stage}`]);
      });
    }

    it(`pre-due email ${type}`, () => {
      const args = { docType: type, number: 12, total: 3600, dueDate: "2026-07-20" };
      expect(preDueEmailContent(args)).toEqual(PRE_DUE_PINS[type]);
    });

    for (const [stage, days] of [[null, -4], [null, 0], [null, 1], [3, 5], [14, 16], [30, 32]] as const) {
      it(`whatsapp ${type} stage ${stage} at ${days} days`, () => {
        const args = {
          businessName: "עסק",
          clientName: "לקוח",
          number: 12,
          total: 3600,
          docType: type,
          date: "05.07.2026",
          dueDate: "20.07.2026",
          days,
          stage,
          viewUrl: "https://friendlyinvoice.co.il/view/x",
        };
        expect(whatsappReminderText(args)).toBe(waPin(type, stage, days));
        expect(whatsappReminderText({ ...args, dueDateHidden: false })).toBe(waPin(type, stage, days));
      });
    }
  }

  it("the pre-due plan still picks up a visible due date", () => {
    const today = new Date(2026, 8, 16);
    const base = {
      id: "d",
      client_id: "c",
      date: "2026-08-01",
      due_date: "2026-09-19",
      type: "tax_invoice",
      status: "sent",
      paid_at: null,
      converted_to_id: null,
    };
    const emails = new Map([["c", "a@b.c"]]);
    for (const doc of [base, { ...base, due_date_hidden: false }, { ...base, due_date_hidden: null }]) {
      expect(planPreDueEmails([doc], emails, [], today).map((p) => p.daysUntilDue)).toEqual([3]);
    }
  });
});

/* ------------------------------------------------------------------ */
/* the route                                                           */
/* ------------------------------------------------------------------ */

const ROUTE_NOW = new Date(2026, 8, 16, 10, 0);

function isoDaysBefore(base: Date, days: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// sha256 of the HTML body the route sent for a visible due date before hidden
// due dates existed (origin CANONICAL_ORIGIN under the test env, clock ROUTE_NOW).
const HTML_SHA: Record<string, string> = {
  "tax_invoice:3": "50eaf7a12f33541be2e314be5fba6f11a7ab0aa57c01975900f3802def2e83d3",
  "tax_invoice:14": "1c7164a782f5d006071f5f677be311c215106686f4079c6eb7ecfc8773ca9233",
  "tax_invoice:30": "2db48dde74b2ace54e1a6657a58db290294f0097e4a61d02af62ad2ec7f5bd65",
  "proforma:3": "bbe005807bb8c4818862f0b091e655c1894780bf4fa371dc86a90d59935f9523",
  "proforma:14": "7833d38c57ecbab70bec680e24a8c3cb1d6557a46cca76c48ce0a9b9292c1862",
  "proforma:30": "ec0b804cb5f3ac64e571fda9ca1d3548f6e48abe494432a48ba1a50f30a6290d",
  "tax_invoice:pre": "2360d68431c3f1e0900c51273239088f881b76ed82e4ed71bb72f981d59265f4",
  "proforma:pre": "a83cc9dae54b2368368eb681dd6a822c8d5c9752210dcafa7a09bd5099f1e88b",
};

function business(): Row {
  return {
    id: "b1",
    name: "עסק",
    dunning_enabled: true,
    dunning_whatsapp_enabled: true,
    dunning_pre_due_enabled: true,
    dunning_from_name: null,
    email: "owner@example.com",
    user_id: "u1",
  };
}

async function run() {
  return (await POST(
    new NextRequest("http://localhost/api/dunning/run", {
      method: "POST",
      headers: { "x-cron-secret": "cron-secret" },
    }),
  )).json();
}

describe("visible due date: the dunning route sends the same email", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ROUTE_NOW);
    state.sent = [];
    state.notifications = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // `undefined` = the column as the route saw it before it selected it.
  for (const hidden of [undefined, false] as const) {
    for (const type of ["tax_invoice", "proforma"] as const) {
      for (const stage of [3, 14, 30] as const) {
        it(`${type} stage ${stage} (due_date_hidden ${hidden})`, async () => {
          const age = stage + 2;
          const due = isoDaysBefore(ROUTE_NOW, age);
          state.tables = {
            businesses: [business()],
            clients: [{ id: "cl-1", email: "client@example.com", phone: "054-900-0684" }],
            documents: [
              {
                id: "doc-1",
                business_id: "b1",
                client_id: "cl-1",
                client_name: "דני",
                number: 12,
                date: isoDaysBefore(ROUTE_NOW, age + 40),
                due_date: due,
                ...(hidden === undefined ? {} : { due_date_hidden: hidden }),
                total: 3600,
                currency: "ILS",
                type,
                status: "sent",
                paid_at: null,
                converted_to_id: null,
              },
            ],
            dunning_log: [],
          };
          const body = await run();
          expect(body).toMatchObject({ sent: 1, prepared: 1, errors: 0 });
          expect(state.sent).toHaveLength(1);
          const [mail] = state.sent;
          const pin = EMAIL_PINS[`${type}:${stage}`];
          const [y, m, d] = due.split("-");
          const fix = (s: string) =>
            s.replace("20.07.2026", `${d}.${m}.${y}`).replace(/\d+ ימים/, `${age} ימים`);
          expect(mail.subject).toBe(pin.subject);
          expect(mail.text).toBe(
            `שלום דני,\n\n${fix(pin.intro)}\n\n${pin.cta}\n\nלצפייה במסמך:\n${CANONICAL_ORIGIN}/view/doc-1\n\n${pin.signoff}\nעסק\n`,
          );
          const sha = createHash("sha256").update(mail.html).digest("hex");
          expect(sha, `html sha for ${type}:${stage}`).toBe(HTML_SHA[`${type}:${stage}`]);
          const wa = state.notifications.find((n) => n.kind === "whatsapp_reminder_ready");
          const label = type === "proforma" ? "חשבון עסקה" : "חשבונית מס";
          expect(wa).toMatchObject({ title: `${label} #12 של דני: ${age} ימים בלי תשלום` });
        });
      }

      it(`${type} pre-due (due_date_hidden ${hidden})`, async () => {
        state.tables = {
          businesses: [business()],
          clients: [{ id: "cl-1", email: "client@example.com", phone: "054-900-0684" }],
          documents: [
            {
              id: "doc-1",
              business_id: "b1",
              client_id: "cl-1",
              client_name: "דני",
              number: 12,
              date: "2026-09-01",
              due_date: "2026-09-19",
              ...(hidden === undefined ? {} : { due_date_hidden: hidden }),
              total: 3600,
              currency: "ILS",
              type,
              status: "sent",
              paid_at: null,
              converted_to_id: null,
            },
          ],
          dunning_log: [],
        };
        const body = await run();
        expect(body).toMatchObject({ sent: 1, prepared: 0, errors: 0 });
        const [mail] = state.sent;
        const pin = PRE_DUE_PINS[type];
        expect(mail.subject).toBe(pin.subject);
        expect(mail.text).toBe(
          `שלום דני,\n\n${pin.intro.replace("20.07.2026", "19.09.2026")}\n\n${pin.cta}\n\nלצפייה במסמך:\n${CANONICAL_ORIGIN}/view/doc-1\n\n${pin.signoff}\nעסק\n`,
        );
        const sha = createHash("sha256").update(mail.html).digest("hex");
        expect(sha, `html sha for ${type}:pre`).toBe(HTML_SHA[`${type}:pre`]);
      });
    }
  }
});

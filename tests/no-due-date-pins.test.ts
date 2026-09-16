import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Byte-for-byte pins for a document WITHOUT a due date. Written against the
// code as it was before lateness started to count from `due_date`, and kept
// green after: every client-facing reminder text, every plan decision, every
// aging bucket and every forecast date below must stay exactly as it was for
// a document that states no payment date.

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
import { dunningEmailContent, whatsappReminderText, daysSinceIssue, type DunningStage } from "@/lib/dunning-copy";
import { planDunningEmails } from "@/lib/dunning-plan";
import { planAssistedReminders } from "@/lib/assisted-dunning";
import { AGING_BUCKET_LABELS, bucketIndex, computeAging, daysOverdue } from "@/lib/aging";
import { forecastCashFlow } from "@/lib/cash-flow-forecast";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import type { InvoiceDocument } from "@/lib/types";

// LRI, shekel sign, narrow no-break space, amount, PDI (format.ts shekel()).
// Built from char codes so the invisible characters stay reviewable.
const SHEKEL_3600 = `${String.fromCharCode(0x2066, 0x20aa, 0x202f)}3,600${String.fromCharCode(0x2069)}`;

/* ------------------------------------------------------------------ */
/* copy                                                                */
/* ------------------------------------------------------------------ */

const EMAIL_PINS: Record<string, { subject: string; intro: string; cta: string; signoff: string }> = {
  "tax_invoice:3": {
    subject: "תזכורת: חשבונית מספר 12",
    intro: `מקווה שהמסמך הגיע בסדר. רק רציתי לוודא שראיתם את חשבונית המס מספר 12 על סך ${SHEKEL_3600} ששלחנו ב-05.07.2026.`,
    cta: "אם נוח לכם, אשמח לסגור את התשלום. כל פרטי התשלום נמצאים בחשבונית.",
    signoff: "תודה רבה,",
  },
  "tax_invoice:14": {
    subject: "תזכורת שנייה: חשבונית מספר 12",
    intro: `אנחנו עוקבים אחרי חשבונית מספר 12 על סך ${SHEKEL_3600} ששלחנו ב-05.07.2026. חלפו כבר 16 ימים ולא ראינו את התשלום.`,
    cta: "אשמח לקבל עדכון: האם התשלום בוצע ולא הגיע, או שעדיין מתעכב?",
    signoff: "תודה,",
  },
  "tax_invoice:30": {
    subject: "חשבונית מספר 12: תשלום מתעכב",
    intro: `חשבונית מספר 12 על סך ${SHEKEL_3600} מ-05.07.2026 עדיין לא שולמה. חלפו 32 ימים.`,
    cta: "אנא תאמו אתנו תאריך תשלום בהקדם. אם יש בעיה או שאלה, נשמח לסייע.",
    signoff: "בכבוד רב,",
  },
  "proforma:3": {
    subject: "תזכורת: חשבון עסקה מספר 12",
    intro: `מקווה שהמסמך הגיע בסדר. רק רציתי לוודא שראיתם את חשבון העסקה מספר 12 על סך ${SHEKEL_3600} ששלחנו ב-05.07.2026.`,
    cta: "אם נוח לכם, אשמח לסגור את התשלום. כל פרטי התשלום נמצאים בחשבון העסקה.",
    signoff: "תודה רבה,",
  },
  "proforma:14": {
    subject: "תזכורת שנייה: חשבון עסקה מספר 12",
    intro: `אנחנו עוקבים אחרי חשבון עסקה מספר 12 על סך ${SHEKEL_3600} ששלחנו ב-05.07.2026. חלפו כבר 16 ימים ולא ראינו את התשלום.`,
    cta: "אשמח לקבל עדכון: האם התשלום בוצע ולא הגיע, או שעדיין מתעכב?",
    signoff: "תודה,",
  },
  "proforma:30": {
    subject: "חשבון עסקה מספר 12: תשלום מתעכב",
    intro: `חשבון עסקה מספר 12 על סך ${SHEKEL_3600} מ-05.07.2026 עדיין לא שולם. חלפו 32 ימים.`,
    cta: "אנא תאמו אתנו תאריך תשלום בהקדם. אם יש בעיה או שאלה, נשמח לסייע.",
    signoff: "בכבוד רב,",
  },
};

const WA_TAIL = "\n\nלצפייה במסמך: https://friendlyinvoice.co.il/view/x\n\n";
const WA_PRE_CTA = "כל פרטי התשלום נמצאים במסמך. אם כבר שילמת, אפשר להתעלם מההודעה.";

function waPin(type: "tax_invoice" | "proforma", stage: DunningStage | null): string {
  if (stage === null) {
    const noun = type === "proforma" ? "חשבון העסקה" : "החשבונית";
    return `שלום לקוח,\n\nשלחתי לך את ${noun} מספר 12 על סך ${SHEKEL_3600} מ-05.07.2026, אשמח לתשלום.\n\n${WA_PRE_CTA}${WA_TAIL}תודה,\nעסק`;
  }
  const e = EMAIL_PINS[`${type}:${stage}`];
  return `שלום לקוח,\n\n${e.intro}\n\n${e.cta}${WA_TAIL}${e.signoff}\nעסק`;
}

describe("no due date: reminder copy is unchanged", () => {
  it("pins the shekel rendering the literals above rely on", () => {
    expect([...SHEKEL_3600].map((c) => c.codePointAt(0))).toEqual([
      0x2066, 0x20aa, 0x202f, 0x33, 0x2c, 0x36, 0x30, 0x30, 0x2069,
    ]);
  });

  for (const type of ["tax_invoice", "proforma"] as const) {
    for (const stage of [3, 14, 30] as const) {
      it(`email ${type} stage ${stage}`, () => {
        const args = { stage, docType: type, number: 12, total: 3600, date: "2026-07-05", days: stage + 2 };
        expect(dunningEmailContent(args)).toEqual(EMAIL_PINS[`${type}:${stage}`]);
        expect(dunningEmailContent({ ...args, dueDate: null })).toEqual(EMAIL_PINS[`${type}:${stage}`]);
        expect(dunningEmailContent({ ...args, dueDate: undefined })).toEqual(EMAIL_PINS[`${type}:${stage}`]);
      });
    }
    for (const stage of [null, 3, 14, 30] as const) {
      it(`whatsapp ${type} stage ${stage}`, () => {
        const args = {
          businessName: "עסק",
          clientName: "לקוח",
          number: 12,
          total: 3600,
          docType: type,
          date: "05.07.2026",
          days: (stage ?? 1) + 2,
          stage,
          viewUrl: "https://friendlyinvoice.co.il/view/x",
        };
        expect(whatsappReminderText(args)).toBe(waPin(type, stage));
        expect(whatsappReminderText({ ...args, dueDate: null })).toBe(waPin(type, stage));
        expect(whatsappReminderText({ ...args, dueDate: "" })).toBe(waPin(type, stage));
      });
    }
  }
});

/* ------------------------------------------------------------------ */
/* plan decisions                                                      */
/* ------------------------------------------------------------------ */

function isoDaysBefore(base: Date, days: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function expectedStage(days: number): DunningStage | null {
  if (days >= 30) return 30;
  if (days >= 14) return 14;
  if (days >= 3) return 3;
  return null;
}

describe("no due date: plan decisions are unchanged", () => {
  const TODAY = new Date(2026, 8, 16);

  for (let age = -2; age <= 40; age++) {
    it(`issued ${age} days ago`, () => {
      const date = isoDaysBefore(TODAY, age);
      expect(daysSinceIssue(date, TODAY)).toBe(age);
      const base = {
        id: "d",
        client_id: "c",
        client_name: "לקוח",
        number: 1,
        date,
        total: 100,
        type: "tax_invoice",
        status: "sent",
        paid_at: null,
        converted_to_id: null,
      };
      for (const doc of [base, { ...base, due_date: null }]) {
        const stage = expectedStage(age);
        const email = planDunningEmails([doc], new Map([["c", "a@b.c"]]), [], TODAY);
        expect(email.queue.map((q) => [q.stage, q.days])).toEqual(stage ? [[stage, age]] : []);
        expect(email.skipped).toBe(stage ? 0 : 1);
        expect(email.noEmail).toEqual([]);
        const wa = planAssistedReminders([doc], [{ id: "c", phone: "054-900-0684" }], [], TODAY);
        expect(wa.map((w) => [w.stage, w.days, w.title])).toEqual(
          stage ? [[stage, age, `חשבונית מס #1 של לקוח: ${age} ימים בלי תשלום`]] : [],
        );
      }
    });
  }
});

/* ------------------------------------------------------------------ */
/* the route: what actually leaves the mail server                     */
/* ------------------------------------------------------------------ */

const ROUTE_NOW = new Date(2026, 8, 16, 10, 0);

// sha256 of the HTML body the route sent before due dates were honoured
// (the origin is CANONICAL_ORIGIN under the test env, the clock ROUTE_NOW).
const HTML_SHA: Record<string, string> = {
  "tax_invoice:3": "d6e2f982f466db6ce0613cbc3976e625ed8bfd259aa436c733b61834708d8bd5",
  "tax_invoice:14": "3106450e7a08f18be494305371b2ccb9cefe35f5f0be3e88e37690b306ac1a7a",
  "tax_invoice:30": "f39ab0f6f331f1de49042a1b52d5beaeebf523955629a12cf3a17e96b090a520",
  "proforma:3": "c3a16ef6e23f930a6e6d9cb0c1924a0b09fdedae6460819876517c7424aa761c",
  "proforma:14": "1b3eb34fe266ca0db43005cd053251d9addf2218db31a9c27fcf3a113904f725",
  "proforma:30": "95021d1ea4949a971a952044a6eee631a88345857a27f9db12046baa9585b2f1",
};

describe("no due date: the dunning route sends the same email", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ROUTE_NOW);
    state.sent = [];
    state.notifications = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const type of ["tax_invoice", "proforma"] as const) {
    for (const stage of [3, 14, 30] as const) {
      it(`${type} stage ${stage}`, async () => {
        const age = stage + 2;
        const date = isoDaysBefore(ROUTE_NOW, age);
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
          clients: [{ id: "cl-1", email: "client@example.com", phone: "054-900-0684" }],
          documents: [
            {
              id: "doc-1",
              business_id: "b1",
              client_id: "cl-1",
              client_name: "דני",
              number: 12,
              date,
              due_date: null,
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
        const body = await (await POST(
          new NextRequest("http://localhost/api/dunning/run", {
            method: "POST",
            headers: { "x-cron-secret": "cron-secret" },
          }),
        )).json();
        expect(body).toMatchObject({ sent: 1, prepared: 1, skipped: 0, errors: 0 });
        expect(state.sent).toHaveLength(1);
        const [mail] = state.sent;
        const pin = EMAIL_PINS[`${type}:${stage}`];
        const [y, m, d] = date.split("-");
        const fix = (s: string) =>
          s.replace("05.07.2026", `${d}.${m}.${y}`).replace(/\d+ ימים/, `${age} ימים`);
        expect(mail.subject).toBe(pin.subject);
        expect(mail.text).toBe(
          `שלום דני,\n\n${fix(pin.intro)}\n\n${pin.cta}\n\nלצפייה במסמך:\n${CANONICAL_ORIGIN}/view/doc-1\n\n${pin.signoff}\nעסק\n`,
        );
        const sha = createHash("sha256").update(mail.html).digest("hex");
        expect(sha, `html sha for ${type}:${stage}`).toBe(HTML_SHA[`${type}:${stage}`]);
        const wa = state.notifications.find((n) => n.kind === "whatsapp_reminder_ready");
        const label = type === "proforma" ? "חשבון עסקה" : "חשבונית מס";
        expect(wa).toMatchObject({
          title: `${label} #12 של דני: ${age} ימים בלי תשלום`,
          body: "לחצו כדי לשלוח תזכורת בוואטסאפ מהמספר שלכם",
          href: "/documents/doc-1?remind=whatsapp",
        });
      });
    }
  }
});

/* ------------------------------------------------------------------ */
/* aging                                                               */
/* ------------------------------------------------------------------ */

function agingDocs(): InvoiceDocument[] {
  const now = new Date();
  return [0, 1, 30, 31, 60, 61, 90, 91, 400].map((n, i) => ({
    id: `a${i}`,
    type: i % 2 ? "proforma" : "tax_invoice",
    number: i,
    date: isoDaysBefore(now, n),
    clientId: i % 3 ? "c1" : "c2",
    clientName: i % 3 ? "א" : "ב",
    status: "sent",
    items: [],
    subtotal: 0,
    vat: 0,
    total: 100 * (i + 1),
  }));
}

describe("no due date: aging is unchanged", () => {
  it("keeps the issue-basis labels", () => {
    expect(AGING_BUCKET_LABELS).toEqual(["0-30 ימים", "31-60 ימים", "61-90 ימים", "מעל 90 ימים"]);
  });

  it("keeps days and buckets", () => {
    expect(agingDocs().map((d) => [daysOverdue(d), bucketIndex(daysOverdue(d))])).toEqual([
      [0, 0], [1, 0], [30, 0], [31, 1], [60, 1], [61, 2], [90, 2], [91, 3], [400, 3],
    ]);
  });

  const EXPECTED_ROWS = [
    {
      clientId: "c1",
      clientName: "א",
      buckets: [500, 500, 600, 1700],
      total: 3300,
      docs: ["a1", "a2", "a4", "a5", "a7", "a8"],
      openAmounts: { a1: 200, a2: 300, a4: 500, a5: 600, a7: 800, a8: 900 },
    },
    {
      clientId: "c2",
      clientName: "ב",
      buckets: [100, 400, 700, 0],
      total: 1200,
      docs: ["a0", "a3", "a6"],
      openAmounts: { a0: 100, a3: 400, a6: 700 },
    },
  ];

  const pick = (res: ReturnType<typeof computeAging>) => ({
    totals: { buckets: res.totals.buckets, grand: res.totals.grand, docCount: res.totals.docCount },
    rows: res.rows.map((r) => ({
      clientId: r.clientId,
      clientName: r.clientName,
      buckets: r.buckets,
      total: r.total,
      docs: r.docs.map((d) => d.id),
      openAmounts: r.openAmounts,
    })),
  });
  const EXPECTED = { totals: { buckets: [600, 900, 1300, 1700], grand: 4500, docCount: 9 }, rows: EXPECTED_ROWS };

  it("computeAging with no basis argument", () => {
    expect(pick(computeAging(agingDocs(), []))).toEqual(EXPECTED);
  });

  it("the due basis falls back to the issue date for documents with no due date", () => {
    expect(pick(computeAging(agingDocs(), [], "due"))).toEqual(EXPECTED);
    expect(pick(computeAging(agingDocs(), [], "issue"))).toEqual(EXPECTED);
  });
});

/* ------------------------------------------------------------------ */
/* forecast                                                            */
/* ------------------------------------------------------------------ */

describe("no due date: forecast dates are unchanged", () => {
  it("dates open documents by terms, median and fallback exactly as before", () => {
    const base = { items: [], subtotal: 0, vat: 0 };
    const docs: InvoiceDocument[] = [
      { ...base, id: "f1", type: "tax_invoice", number: 1, date: "2026-09-01", clientId: "c1", clientName: "א", status: "sent", total: 1000 },
      { ...base, id: "f2", type: "proforma", number: 2, date: "2026-08-10", clientId: "c2", clientName: "ב", status: "sent", total: 2000 },
      { ...base, id: "f3", type: "tax_invoice", number: 3, date: "2026-09-10", clientId: "c3", clientName: "ג", status: "sent", total: 3000 },
      { ...base, id: "f4", type: "receipt", number: 4, date: "2026-06-01", clientId: "c3", clientName: "ג", status: "paid", paidAt: "2026-06-20T10:00:00Z", total: 50 },
    ];
    const f = forecastCashFlow({
      documents: docs,
      expenses: [],
      business: { businessType: "exempt" },
      today: "2026-09-16",
      clients: [{ id: "c1", name: "א", taxId: undefined, paymentTerms: "eom_30" }],
    });
    const line = (date: string, amount: number, label: string, id: string, clientName: string) => ({
      date, amount, kind: "open_invoice", confidence: "certain", label, href: `/documents/${id}`, clientName, documentId: id,
    });
    expect(f.months.map((m) => ({ period: m.period, inflow: m.inflow, lines: m.lines }))).toEqual([
      {
        period: "2026-09",
        inflow: 5000,
        lines: [
          line("2026-09-16", 2000, "חשבון עסקה 2", "f2", "ב"),
          line("2026-09-29", 3000, "חשבונית מס 3", "f3", "ג"),
        ],
      },
      { period: "2026-10", inflow: 1000, lines: [line("2026-10-30", 1000, "חשבונית מס 1", "f1", "א")] },
      { period: "2026-11", inflow: 0, lines: [] },
    ]);
    expect(f.assumptions).toEqual([
      "לא נרשמו הוצאות בשלושת החודשים המלאים האחרונים, ולכן התחזית לא כוללת הוצאות שוטפות.",
      "לא הוגדר אחוז מקדמות מס הכנסה, ולכן התחזית לא כוללת מקדמות. אפשר להזין אותו בדוח מקדמות מס הכנסה.",
      "מסמכים של לקוחות שהוגדרו להם תנאי תשלום מתוארכים לפי התנאים שסוכמו.",
      "ללקוחות שלא הוגדרו להם תנאי תשלום, מועד התשלום נאמד לפי חציון ימי התשלום של אותו לקוח בעבר.",
      "מסמך פתוח שכבר עבר את מועד התשלום הצפוי שלו מוצג בחודש הנוכחי.",
      "ללקוחות שאין להם היסטוריית תשלומים הונחו 30 ימים עד לתשלום.",
    ]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// A document whose owner hid the "לתשלום עד" line (documents.due_date_hidden):
// its reminders are still TIMED from the due date, but never name it, and the
// pre-due email (whose only content is that date) is not sent at all.
// The visible and no-due-date behaviour is pinned in due-date-visible-pins
// and no-due-date-pins.

type Row = Record<string, unknown>;

const state = vi.hoisted(() => {
  process.env.DUNNING_CRON_SECRET = "cron-secret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.GMAIL_USER = "app@example.com";
  process.env.GMAIL_APP_PASSWORD = "pass word";
  return {
    tables: {} as Record<string, Row[]>,
    selects: {} as Record<string, string>,
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
import {
  DUNNING_HIDDEN_DUE_INTROS,
  PRE_DUE_BUCKET,
  dueDateUse,
  dunningEmailContent,
  dunningStageFor,
  preDueDaysUntil,
  preDueEmailContent,
  whatsappReminderText,
  type DunningStage,
} from "@/lib/dunning-copy";
import { planDunningEmails, planPreDueEmails, type EmailPlanDoc } from "@/lib/dunning-plan";
import { CANONICAL_ORIGIN } from "@/lib/public-url";

const SHEKEL_3600 = `${String.fromCharCode(0x2066, 0x20aa, 0x202f)}3,600${String.fromCharCode(0x2069)}`;
const LONG_DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
const STAGES: DunningStage[] = [3, 14, 30];

/* ------------------------------------------------------------------ */
/* the helper                                                          */
/* ------------------------------------------------------------------ */

describe("dueDateUse", () => {
  it("separates the timing anchor from what the client may be told", () => {
    expect(dueDateUse("2026-07-20", true)).toEqual({ anchor: "2026-07-20", wording: "unnamed" });
    for (const hidden of [false, null, undefined]) {
      expect(dueDateUse("2026-07-20", hidden)).toEqual({ anchor: "2026-07-20", wording: "named" });
    }
    for (const bad of [null, undefined, "", "2026-02-30"]) {
      expect(dueDateUse(bad, true)).toEqual({ anchor: null, wording: "none" });
      expect(dueDateUse(bad, false)).toEqual({ anchor: null, wording: "none" });
    }
  });
});

/* ------------------------------------------------------------------ */
/* copy                                                                */
/* ------------------------------------------------------------------ */

const HIDDEN_EMAIL: Record<string, { subject: string; intro: string; cta: string; signoff: string }> = {
  "tax_invoice:3": {
    subject: "תזכורת: חשבונית מספר 12",
    intro: `רק רציתי לוודא שראיתם את חשבונית המס מספר 12 על סך ${SHEKEL_3600}.`,
    cta: "אם נוח לכם, אשמח לסגור את התשלום. כל פרטי התשלום נמצאים בחשבונית.",
    signoff: "תודה רבה,",
  },
  "tax_invoice:14": {
    subject: "תזכורת שנייה: חשבונית מספר 12",
    intro: `אנחנו עוקבים אחרי חשבונית מספר 12 על סך ${SHEKEL_3600} ולא ראינו את התשלום.`,
    cta: "אשמח לקבל עדכון: האם התשלום בוצע ולא הגיע, או שעדיין מתעכב?",
    signoff: "תודה,",
  },
  "tax_invoice:30": {
    subject: "חשבונית מספר 12: תשלום מתעכב",
    intro: `חשבונית מספר 12 על סך ${SHEKEL_3600} עדיין לא שולמה.`,
    cta: "אנא תאמו אתנו תאריך תשלום בהקדם. אם יש בעיה או שאלה, נשמח לסייע.",
    signoff: "בכבוד רב,",
  },
  "proforma:3": {
    subject: "תזכורת: חשבון עסקה מספר 12",
    intro: `רק רציתי לוודא שראיתם את חשבון העסקה מספר 12 על סך ${SHEKEL_3600}.`,
    cta: "אם נוח לכם, אשמח לסגור את התשלום. כל פרטי התשלום נמצאים בחשבון העסקה.",
    signoff: "תודה רבה,",
  },
  "proforma:14": {
    subject: "תזכורת שנייה: חשבון עסקה מספר 12",
    intro: `אנחנו עוקבים אחרי חשבון עסקה מספר 12 על סך ${SHEKEL_3600} ולא ראינו את התשלום.`,
    cta: "אשמח לקבל עדכון: האם התשלום בוצע ולא הגיע, או שעדיין מתעכב?",
    signoff: "תודה,",
  },
  "proforma:30": {
    subject: "חשבון עסקה מספר 12: תשלום מתעכב",
    intro: `חשבון עסקה מספר 12 על סך ${SHEKEL_3600} עדיין לא שולם.`,
    cta: "אנא תאמו אתנו תאריך תשלום בהקדם. אם יש בעיה או שאלה, נשמח לסייע.",
    signoff: "בכבוד רב,",
  },
};

const WA_TAIL = "\n\nלצפייה במסמך: https://friendlyinvoice.co.il/view/x\n\n";
const WA_PRE_CTA = "כל פרטי התשלום נמצאים במסמך. אם כבר שילמת, אפשר להתעלם מההודעה.";

describe("hidden due date: email copy", () => {
  const base = { number: 12, total: 3600, date: "2026-07-05", dueDate: "2026-07-20", dueDateHidden: true };

  for (const docType of ["tax_invoice", "proforma"] as const) {
    for (const stage of STAGES) {
      it(`${docType} stage ${stage}`, () => {
        const c = dunningEmailContent({ ...base, stage, docType, days: stage + 2 });
        expect(c).toEqual(HIDDEN_EMAIL[`${docType}:${stage}`]);
        const all = Object.values(c).join("\n");
        for (const leak of ["20.07.2026", "2026-07-20", "05.07.2026", "מועד התשלום", "ימים", "ששלחנו"]) {
          expect(all).not.toContain(leak);
        }
      });
    }

    it(`${docType}: no pre-due email content can be built`, () => {
      expect(() => preDueEmailContent({ docType, number: 12, total: 3600, dueDate: "2026-07-20", dueDateHidden: true })).toThrow();
    });
  }

  it("the intros constant is free of long dashes and date or day placeholders", () => {
    for (const line of Object.values(DUNNING_HIDDEN_DUE_INTROS)) {
      for (const dash of LONG_DASHES) expect(line.includes(dash)).toBe(false);
      expect(line).not.toMatch(/\{(date|dueDate|days)\}/);
    }
  });
});

describe("hidden due date: WhatsApp text", () => {
  const args = {
    businessName: "עסק",
    clientName: "לקוח",
    number: 12,
    total: 3600,
    date: "05.07.2026",
    dueDate: "20.07.2026",
    dueDateHidden: true,
    viewUrl: "https://friendlyinvoice.co.il/view/x",
  };

  for (const docType of ["tax_invoice", "proforma"] as const) {
    const noun = docType === "proforma" ? "חשבון העסקה" : "החשבונית";
    for (const days of [-4, 0, 1, 2]) {
      it(`${docType} before stage 3 (${days} days) uses the plain pre-stage text`, () => {
        expect(whatsappReminderText({ ...args, docType, days, stage: dunningStageFor(days) })).toBe(
          `שלום לקוח,\n\nשלחתי לך את ${noun} מספר 12 על סך ${SHEKEL_3600} מ-05.07.2026, אשמח לתשלום.\n\n${WA_PRE_CTA}${WA_TAIL}תודה,\nעסק`,
        );
      });
    }
    for (const stage of STAGES) {
      it(`${docType} stage ${stage} uses the date-less intro`, () => {
        const e = HIDDEN_EMAIL[`${docType}:${stage}`];
        const text = whatsappReminderText({ ...args, docType, days: stage + 2, stage });
        expect(text).toBe(`שלום לקוח,\n\n${e.intro}\n\n${e.cta}${WA_TAIL}${e.signoff}\nעסק`);
        expect(text).not.toContain("20.07.2026");
      });
    }
  }
});

/* ------------------------------------------------------------------ */
/* plans                                                               */
/* ------------------------------------------------------------------ */

const TODAY = new Date(2026, 8, 16);
const EMAILS = new Map<string, string | null>([["cl-1", "client@example.com"]]);

function planDoc(over: Partial<EmailPlanDoc> = {}): EmailPlanDoc {
  return {
    id: "doc-1",
    client_id: "cl-1",
    date: "2026-06-01",
    due_date: "2026-09-19",
    due_date_hidden: true,
    type: "tax_invoice",
    status: "sent",
    paid_at: null,
    converted_to_id: null,
    ...over,
  };
}

describe("hidden due date: plans", () => {
  it("never plans a pre-due email", () => {
    for (const until of [1, 3, 5]) {
      const due = `2026-09-${String(16 + until).padStart(2, "0")}`;
      expect(preDueDaysUntil({ date: "2026-08-01", dueDate: due, dueDateHidden: true }, TODAY)).toBe(null);
      expect(preDueDaysUntil({ date: "2026-08-01", dueDate: due, dueDateHidden: false }, TODAY)).toBe(until);
      expect(planPreDueEmails([planDoc({ due_date: due })], EMAILS, [], TODAY)).toEqual([]);
      expect(planPreDueEmails([planDoc({ due_date: due, due_date_hidden: false })], EMAILS, [], TODAY)).toHaveLength(1);
    }
  });

  it("still times the stages from the due date, not the issue date", () => {
    // Issued 107 days ago; due in 3 days: nothing yet.
    expect(planDunningEmails([planDoc()], EMAILS, [], TODAY).queue).toEqual([]);
    // 15 days past the due date: stage 14, not the issue date's 30.
    const late = planDunningEmails([planDoc({ due_date: "2026-09-01" })], EMAILS, [], TODAY);
    expect(late.queue.map((q) => [q.stage, q.days])).toEqual([[14, 15]]);
  });
});

/* ------------------------------------------------------------------ */
/* the route                                                           */
/* ------------------------------------------------------------------ */

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
    due_date_hidden: true,
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

describe("hidden due date: the dunning route", () => {
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
          dunning_pre_due_enabled: true,
          dunning_from_name: null,
          email: "owner@example.com",
          user_id: "u1",
        },
      ],
      clients: [{ id: "cl-1", email: "client@example.com", phone: "054-900-0684" }],
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

  it("selects due_date_hidden with the documents", async () => {
    await run();
    expect(state.selects.documents.split(",").map((c) => c.trim())).toContain("due_date_hidden");
  });

  for (const type of ["tax_invoice", "proforma"] as const) {
    for (const [stage, due, days] of [[3, "2026-09-12", 4], [14, "2026-09-01", 15], [30, "2026-08-10", 37]] as const) {
      it(`${type} stage ${stage}: the email names no date and no day count; the owner still sees them`, async () => {
        state.tables.documents = [doc({ type, due_date: due })];
        const body = await run();
        expect(body).toMatchObject({ sent: 1, prepared: 1, errors: 0 });
        const [mail] = state.sent;
        const pin = HIDDEN_EMAIL[`${type}:${stage}`];
        expect(mail.subject).toBe(pin.subject);
        expect(mail.text).toBe(
          `שלום דני,\n\n${pin.intro}\n\n${pin.cta}\n\nלצפייה במסמך:\n${CANONICAL_ORIGIN}/view/doc-1\n\n${pin.signoff}\nעסק\n`,
        );
        const [y, m, d] = due.split("-");
        for (const part of [mail.text, mail.html, mail.subject]) {
          expect(part).not.toContain(`${d}.${m}.${y}`);
          expect(part).not.toContain(due);
          expect(part).not.toContain("מועד התשלום");
        }
        expect(mail.html).toContain(pin.intro);
        // Owner-facing: unchanged, day count included.
        const label = type === "proforma" ? "חשבון עסקה" : "חשבונית מס";
        expect(state.notifications.find((n) => n.kind === "whatsapp_reminder_ready")).toMatchObject({
          title: `${label} #12 של דני: ${days} ימים בלי תשלום`,
        });
        expect(state.notifications.find((n) => n.kind === "dunning_sent")).toMatchObject({
          body: `מסמך #12 (${SHEKEL_3600}): תזכורת יום ${stage}.`,
        });
      });
    }
  }

  it("sends no pre-due email for a hidden due date, but does for a visible one", async () => {
    state.tables.documents = [
      doc({ id: "hidden", date: "2026-09-01", due_date: "2026-09-19" }),
      doc({ id: "visible", date: "2026-09-01", due_date: "2026-09-19", due_date_hidden: false }),
    ];
    const body = await run();
    expect(body).toMatchObject({ sent: 1, prepared: 0, errors: 0 });
    expect(body.details).toEqual([{ doc: "visible", bucket: PRE_DUE_BUCKET, outcome: "sent" }]);
    expect(state.sent.map((m) => m.subject)).toEqual(["תזכורת ידידותית: חשבונית מספר 12"]);
    expect(state.tables.dunning_log.map((r) => [r.document_id, r.day_bucket])).toEqual([["visible", PRE_DUE_BUCKET]]);
  });

  it("chases nothing before the hidden due date has passed by 3 days", async () => {
    state.tables.documents = [
      doc({ id: "future", due_date: "2026-09-30" }),
      doc({ id: "two-days", due_date: "2026-09-14" }),
    ];
    const body = await run();
    expect(body).toMatchObject({ sent: 0, prepared: 0, errors: 0 });
    expect(state.sent).toEqual([]);
    expect(state.tables.dunning_log).toEqual([]);
  });

  it("a hidden flag on a document with no due date changes nothing", async () => {
    state.tables.documents = [doc({ date: "2026-09-01", due_date: null })];
    await run();
    expect(state.sent[0].text).toContain(
      `אנחנו עוקבים אחרי חשבונית מספר 12 על סך ${SHEKEL_3600} ששלחנו ב-01.09.2026. חלפו כבר 15 ימים ולא ראינו את התשלום.`,
    );
  });
});

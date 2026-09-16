import { describe, it, expect } from "vitest";
import {
  PRE_DUE_BUCKET,
  PRE_DUE_SUBJECT,
  PRE_DUE_TONE,
  preDueDaysUntil,
  preDueEmailContent,
} from "@/lib/dunning-copy";
import { planDunningEmails, planPreDueEmails, type EmailPlanDoc } from "@/lib/dunning-plan";
import { dunningLogLabel } from "@/lib/dunning-log-label";

// The optional friendly email BEFORE a document's own due date: when it fires,
// what it says, and how its dunning_log row reads in the timeline.

const SHEKEL_3600 = `${String.fromCharCode(0x2066, 0x20aa, 0x202f)}3,600${String.fromCharCode(0x2069)}`;
const LONG_DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
const TODAY = new Date(2026, 8, 16, 10, 0);

function iso(offsetDays: number, base: Date = TODAY): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function doc(over: Partial<EmailPlanDoc> = {}): EmailPlanDoc {
  return {
    id: "doc-1",
    client_id: "cl-1",
    date: iso(-30),
    due_date: iso(3),
    type: "tax_invoice",
    status: "sent",
    paid_at: null,
    converted_to_id: null,
    ...over,
  };
}

const EMAILS = new Map<string, string | null>([
  ["cl-1", "client@example.com"],
  ["cl-2", null],
]);

describe("pre-due timing", () => {
  const cases: Array<[number, number | null]> = [
    [30, null],
    [6, null],
    [5, 5],
    [3, 3],
    [1, 1],
    [0, null],
    [-1, null],
    [-10, null],
  ];
  for (const [until, expected] of cases) {
    it(`${until} days until the due date -> ${expected ?? "nothing"}`, () => {
      const d = { date: iso(-30), dueDate: iso(until) };
      expect(preDueDaysUntil(d, TODAY)).toBe(expected);
      const plan = planPreDueEmails([doc({ due_date: iso(until) })], EMAILS, [], TODAY);
      expect(plan.map((p) => p.daysUntilDue)).toEqual(expected == null ? [] : [expected]);
    });
  }

  it("is stable across the local day, like the stage arithmetic", () => {
    const due = iso(5);
    expect(preDueDaysUntil({ date: iso(-30), dueDate: due }, new Date(2026, 8, 16, 0, 1))).toBe(5);
    expect(preDueDaysUntil({ date: iso(-30), dueDate: due }, new Date(2026, 8, 16, 23, 59))).toBe(5);
  });

  it("needs the due date at least 7 days after the issue date", () => {
    // Due in 3 days; issued 3 days ago (term 6) or 4 days ago (term 7).
    expect(preDueDaysUntil({ date: iso(-3), dueDate: iso(3) }, TODAY)).toBe(null);
    expect(preDueDaysUntil({ date: iso(-4), dueDate: iso(3) }, TODAY)).toBe(3);
    // Issued today, due in 5: a client must not hear "due soon" on day one.
    expect(preDueDaysUntil({ date: iso(0), dueDate: iso(5) }, TODAY)).toBe(null);
    expect(planPreDueEmails([doc({ date: iso(-1), due_date: iso(5) })], EMAILS, [], TODAY)).toEqual([]);
    // Across a month boundary, for both the window and the term.
    const aug30 = new Date(2026, 7, 30, 9, 0);
    expect(preDueDaysUntil({ date: "2026-08-26", dueDate: "2026-09-02" }, aug30)).toBe(3);
    expect(preDueDaysUntil({ date: "2026-08-27", dueDate: "2026-09-02" }, aug30)).toBe(null);
  });

  it("never fires without a usable due date", () => {
    for (const bad of [null, undefined, "", "19/09/2026", "2026-9-19", "2026-02-30", "2026-13-45"]) {
      expect(preDueDaysUntil({ date: iso(-30), dueDate: bad }, TODAY)).toBe(null);
      expect(planPreDueEmails([doc({ due_date: bad })], EMAILS, [], TODAY)).toEqual([]);
    }
    const noDue: EmailPlanDoc = { ...doc() };
    delete noDue.due_date;
    expect(planPreDueEmails([noDue], EMAILS, [], TODAY)).toEqual([]);
  });

  it("never fires on a malformed issue date", () => {
    expect(preDueDaysUntil({ date: "x", dueDate: iso(3) }, TODAY)).toBe(null);
  });
});

describe("pre-due plan", () => {
  it("chases open receivables only, and only with a client email", () => {
    const docs = [
      doc({ id: "ok" }),
      doc({ id: "proforma", type: "proforma" }),
      doc({ id: "quote", type: "quote" }),
      doc({ id: "draft", status: "draft" }),
      doc({ id: "paid", paid_at: "2026-09-10T10:00:00Z" }),
      doc({ id: "converted", converted_to_id: "x" }),
      doc({ id: "no-mail", client_id: "cl-2" }),
      doc({ id: "no-client", client_id: null }),
    ];
    expect(planPreDueEmails(docs, EMAILS, [], TODAY).map((p) => [p.doc.id, p.email])).toEqual([
      ["ok", "client@example.com"],
      ["proforma", "client@example.com"],
    ]);
  });

  it("sends once per document, deduped on its own email bucket only", () => {
    const d = doc();
    expect(planPreDueEmails([d], EMAILS, [{ document_id: "doc-1", day_bucket: PRE_DUE_BUCKET, channel: "email" }], TODAY)).toEqual([]);
    // Pre-channel rows default to email.
    expect(planPreDueEmails([d], EMAILS, [{ document_id: "doc-1", day_bucket: PRE_DUE_BUCKET, channel: null }], TODAY)).toEqual([]);
    // Other buckets and other channels do not block it.
    const unrelated = [
      { document_id: "doc-1", day_bucket: 3, channel: "email" },
      { document_id: "doc-1", day_bucket: PRE_DUE_BUCKET, channel: "whatsapp_assist" },
      { document_id: "doc-2", day_bucket: PRE_DUE_BUCKET, channel: "email" },
    ];
    expect(planPreDueEmails([d], EMAILS, unrelated, TODAY)).toHaveLength(1);
  });

  it("a pre-due row never blocks the later stage 3 email", () => {
    const late = doc({ date: iso(-40), due_date: iso(-3) });
    const logs = [{ document_id: "doc-1", day_bucket: PRE_DUE_BUCKET, channel: "email" }];
    expect(planDunningEmails([late], EMAILS, logs, TODAY).queue.map((q) => q.stage)).toEqual([3]);
  });
});

describe("pre-due email copy", () => {
  const base = { number: 12, total: 3600, dueDate: "2026-09-19" };

  it("renders a tax invoice", () => {
    expect(preDueEmailContent({ ...base, docType: "tax_invoice" })).toEqual({
      subject: "תזכורת ידידותית: חשבונית מספר 12",
      intro: `רצינו להזכיר שמועד התשלום של חשבונית המס מספר 12 על סך ${SHEKEL_3600} הוא ב-19.09.2026.`,
      cta: "כל פרטי התשלום נמצאים בחשבונית. אם כבר שילמתם, אפשר להתעלם מההודעה.",
      signoff: "תודה רבה,",
    });
  });

  it("renders a pro forma", () => {
    expect(preDueEmailContent({ ...base, docType: "proforma" })).toEqual({
      subject: "תזכורת ידידותית: חשבון עסקה מספר 12",
      intro: `רצינו להזכיר שמועד התשלום של חשבון העסקה מספר 12 על סך ${SHEKEL_3600} הוא ב-19.09.2026.`,
      cta: "כל פרטי התשלום נמצאים בחשבון העסקה. אם כבר שילמתם, אפשר להתעלם מההודעה.",
      signoff: "תודה רבה,",
    });
  });

  it("uses the document currency", () => {
    expect(preDueEmailContent({ ...base, docType: "tax_invoice", currency: "USD" }).intro).toContain("$3,600.00");
  });

  it("refuses to build a reminder that names no date", () => {
    for (const bad of [null, undefined, "", "2026-02-30"]) {
      expect(() => preDueEmailContent({ ...base, dueDate: bad })).toThrow();
    }
  });

  it("has no long dash, no placeholder left, and no pressure wording", () => {
    const templates = [PRE_DUE_SUBJECT, ...Object.values(PRE_DUE_TONE)];
    for (const type of ["tax_invoice", "proforma"]) {
      const c = preDueEmailContent({ ...base, docType: type });
      for (const line of [...templates, ...Object.values(c)]) {
        for (const dash of LONG_DASHES) expect(line.includes(dash)).toBe(false);
        for (const word of ["ריבית", "פיגור", "הצמדה", "על פי חוק", "לפי חוק", "קנס"]) {
          expect(line).not.toContain(word);
        }
      }
      for (const line of Object.values(c)) expect(line).not.toMatch(/[{}]/);
    }
  });
});

describe("timeline label for a dunning_log row", () => {
  it("names the pre-due email", () => {
    expect(dunningLogLabel({ day_bucket: PRE_DUE_BUCKET, success: true, channel: "email" })).toEqual({
      title: "נשלחה תזכורת ידידותית לפני מועד התשלום",
      kind: "email",
    });
    expect(dunningLogLabel({ day_bucket: PRE_DUE_BUCKET, success: false, channel: "email" }).kind).toBe("email_failed");
    expect(dunningLogLabel({ day_bucket: PRE_DUE_BUCKET, success: false, channel: "email" }).title).not.toContain("-5");
  });

  it("says a WhatsApp reminder was prepared, never sent", () => {
    expect(dunningLogLabel({ day_bucket: 14, success: true, channel: "whatsapp_assist" })).toEqual({
      title: "הוכנה תזכורת בוואטסאפ (יום 14)",
      kind: "whatsapp",
    });
  });

  it("keeps the stage email wording exactly", () => {
    for (const channel of ["email", null, undefined]) {
      expect(dunningLogLabel({ day_bucket: 3, success: true, channel })).toEqual({
        title: "נשלחה תזכורת תשלום (יום 3)",
        kind: "email",
      });
      expect(dunningLogLabel({ day_bucket: 30, success: false, channel })).toEqual({
        title: "כשל בשליחת תזכורת (יום 30)",
        kind: "email_failed",
      });
    }
  });
});

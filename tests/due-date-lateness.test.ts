import { describe, it, expect } from "vitest";
import {
  DUNNING_DUE_INTROS,
  PRE_STAGE_DUE_INTRO,
  daysLate,
  daysPastDate,
  dunningEmailContent,
  dunningStageFor,
  usableDueDate,
  whatsappReminderText,
  type DunningStage,
} from "@/lib/dunning-copy";
import { RECEIVABLE_TYPES, planDunningEmails, type EmailPlanDoc } from "@/lib/dunning-plan";
import { planAssistedReminders, type AssistedDocRow } from "@/lib/assisted-dunning";
import {
  AGING_BUCKET_LABELS,
  AGING_DUE_BUCKET_LABELS,
  AGING_NOT_YET_DUE_LABEL,
  computeAging,
  daysPastDue,
} from "@/lib/aging";
import { forecastCashFlow } from "@/lib/cash-flow-forecast";
import { DUE_DATE_DOCUMENT_TYPES, type InvoiceDocument } from "@/lib/types";

// Lateness measured from the document's own "לתשלום עד". The no-due-date
// behaviour is pinned separately in no-due-date-pins.test.ts.

const LONG_DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
const SHEKEL_3600 = `${String.fromCharCode(0x2066, 0x20aa, 0x202f)}3,600${String.fromCharCode(0x2069)}`;
const STAGES: DunningStage[] = [3, 14, 30];

function iso(base: Date, offsetDays: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("day arithmetic", () => {
  it("counts whole calendar days past an anchor, negative before it", () => {
    expect(daysPastDate("2026-09-20", new Date(2026, 8, 16, 23, 59))).toBe(-4);
    expect(daysPastDate("2026-09-16", new Date(2026, 8, 16, 0, 1))).toBe(0);
    expect(daysPastDate("2026-09-01", new Date(2026, 8, 16, 12, 0))).toBe(15);
  });

  it("anchors on the due date when one is stated, else on the issue date", () => {
    const now = new Date(2026, 8, 16);
    expect(daysLate({ date: "2026-08-01", dueDate: "2026-09-10" }, now)).toBe(6);
    expect(daysLate({ date: "2026-08-01", dueDate: null }, now)).toBe(46);
    expect(daysLate({ date: "2026-08-01" }, now)).toBe(46);
    // A malformed value is no due date at all.
    expect(daysLate({ date: "2026-08-01", dueDate: "10/09/2026" }, now)).toBe(46);
  });

  it("accepts only a YYYY-MM-DD due date", () => {
    expect(usableDueDate("2026-09-10")).toBe("2026-09-10");
    for (const bad of [null, undefined, "", "2026-9-10", "2026-09-10T00:00:00Z", "x"]) {
      expect(usableDueDate(bad)).toBe(null);
    }
  });

  it("chases the same document types that can carry a due date", () => {
    expect([...RECEIVABLE_TYPES].sort()).toEqual([...DUE_DATE_DOCUMENT_TYPES].sort());
  });
});

/* ------------------------------------------------------------------ */
/* plans                                                               */
/* ------------------------------------------------------------------ */

const TODAY = new Date(2026, 8, 16);

function emailDoc(over: Partial<EmailPlanDoc> = {}): EmailPlanDoc {
  return {
    id: "doc-1",
    client_id: "cl-1",
    date: "2026-06-01", // 107 days before TODAY: stage 30 by issue date
    due_date: null,
    type: "tax_invoice",
    status: "sent",
    paid_at: null,
    converted_to_id: null,
    ...over,
  };
}

function waDoc(over: Partial<AssistedDocRow> = {}): AssistedDocRow {
  return {
    id: "doc-1",
    client_id: "cl-1",
    client_name: "דני",
    number: 7,
    date: "2026-06-01",
    due_date: null,
    total: 100,
    type: "tax_invoice",
    status: "sent",
    paid_at: null,
    converted_to_id: null,
    ...over,
  };
}

const EMAILS = new Map<string, string | null>([["cl-1", "client@example.com"]]);
const PHONES = [{ id: "cl-1", phone: "054-900-0684" }];

describe("stage timing from the due date", () => {
  const cases: Array<[number, DunningStage | null]> = [
    [-20, null],
    [-1, null],
    [0, null],
    [2, null],
    [3, 3],
    [13, 3],
    [14, 14],
    [29, 14],
    [30, 30],
    [95, 30],
  ];
  for (const [past, stage] of cases) {
    it(`${past} days past the due date -> ${stage ?? "nothing"}`, () => {
      const due = iso(TODAY, -past);
      // Issued well before, so the issue-date schedule would say "30" every time.
      const issued = iso(TODAY, -past - 60);
      const email = planDunningEmails([emailDoc({ date: issued, due_date: due })], EMAILS, [], TODAY);
      expect(email.queue.map((q) => [q.stage, q.days])).toEqual(stage ? [[stage, past]] : []);
      const wa = planAssistedReminders([waDoc({ date: issued, due_date: due })], PHONES, [], TODAY);
      expect(wa.map((w) => [w.stage, w.days])).toEqual(stage ? [[stage, past]] : []);
    });
  }

  it("sends no email before the due date, and does not report it as missing an email", () => {
    const docs = [
      emailDoc({ id: "future", client_id: "no-mail", due_date: iso(TODAY, 10) }),
      emailDoc({ id: "today", client_id: "no-mail", due_date: iso(TODAY, 0) }),
      emailDoc({ id: "two-days", client_id: null, due_date: iso(TODAY, -2) }),
    ];
    const { queue, skipped, noEmail } = planDunningEmails(docs, EMAILS, [], TODAY);
    expect(queue).toEqual([]);
    expect(skipped).toBe(3);
    expect(noEmail).toEqual([]);
  });

  it("still reports a past-due document whose client has no email", () => {
    const doc = emailDoc({ client_id: "no-mail", due_date: iso(TODAY, -15) });
    const { noEmail } = planDunningEmails([doc], EMAILS, [], TODAY);
    expect(noEmail).toEqual([{ doc, stage: 14 }]);
  });

  it("fires each stage at most once per document", () => {
    const doc = emailDoc({ due_date: iso(TODAY, -15) });
    const logs = [{ document_id: "doc-1", day_bucket: 14, channel: "email" }];
    expect(planDunningEmails([doc], EMAILS, logs, TODAY).queue).toEqual([]);
    const waLogs = [{ document_id: "doc-1", day_bucket: 14, channel: "whatsapp_assist" }];
    expect(planAssistedReminders([waDoc({ due_date: iso(TODAY, -15) })], PHONES, waLogs, TODAY)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* copy                                                                */
/* ------------------------------------------------------------------ */

const DUE_EMAIL: Record<string, string> = {
  "tax_invoice:3": `רק רציתי לוודא שראיתם את חשבונית המס מספר 12 על סך ${SHEKEL_3600}. מועד התשלום היה ב-20.07.2026.`,
  "tax_invoice:14": `אנחנו עוקבים אחרי חשבונית מספר 12 על סך ${SHEKEL_3600}. מועד התשלום היה ב-20.07.2026, וחלפו מאז 16 ימים ולא ראינו את התשלום.`,
  "tax_invoice:30": `חשבונית מספר 12 על סך ${SHEKEL_3600} עדיין לא שולמה. מועד התשלום היה ב-20.07.2026, וחלפו מאז 32 ימים.`,
  "proforma:3": `רק רציתי לוודא שראיתם את חשבון העסקה מספר 12 על סך ${SHEKEL_3600}. מועד התשלום היה ב-20.07.2026.`,
  "proforma:14": `אנחנו עוקבים אחרי חשבון עסקה מספר 12 על סך ${SHEKEL_3600}. מועד התשלום היה ב-20.07.2026, וחלפו מאז 16 ימים ולא ראינו את התשלום.`,
  "proforma:30": `חשבון עסקה מספר 12 על סך ${SHEKEL_3600} עדיין לא שולם. מועד התשלום היה ב-20.07.2026, וחלפו מאז 32 ימים.`,
};

const DUE_PRE: Record<string, string> = {
  tax_invoice: `שלחתי לך את החשבונית מספר 12 על סך ${SHEKEL_3600} מ-05.07.2026, אשמח לתשלום עד 20.07.2026.`,
  proforma: `שלחתי לך את חשבון העסקה מספר 12 על סך ${SHEKEL_3600} מ-05.07.2026, אשמח לתשלום עד 20.07.2026.`,
};

describe("due-date reminder copy", () => {
  const base = { number: 12, total: 3600, date: "2026-07-05", dueDate: "2026-07-20" };

  for (const docType of ["tax_invoice", "proforma"] as const) {
    for (const stage of STAGES) {
      it(`email ${docType} stage ${stage} names the due date and keeps subject, CTA and signoff`, () => {
        const withDue = dunningEmailContent({ ...base, stage, docType, days: stage + 2 });
        const without = dunningEmailContent({ ...base, dueDate: null, stage, docType, days: stage + 2 });
        expect(withDue.intro).toBe(DUE_EMAIL[`${docType}:${stage}`]);
        expect(withDue.subject).toBe(without.subject);
        expect(withDue.cta).toBe(without.cta);
        expect(withDue.signoff).toBe(without.signoff);
        expect(withDue.intro).not.toContain("2026-07-20");
        expect(withDue.intro).not.toContain("ששלחנו");
      });

      it(`whatsapp ${docType} stage ${stage} uses the same intro`, () => {
        const text = whatsappReminderText({
          businessName: "עסק",
          clientName: "לקוח",
          number: 12,
          total: 3600,
          docType,
          date: "05.07.2026",
          dueDate: "20.07.2026",
          days: stage + 2,
          stage,
          viewUrl: "https://example.com/view/x",
        });
        const email = dunningEmailContent({ ...base, stage, docType, days: stage + 2 });
        expect(text).toBe(
          `שלום לקוח,\n\n${email.intro}\n\n${email.cta}\n\nלצפייה במסמך: https://example.com/view/x\n\n${email.signoff}\nעסק`,
        );
      });
    }

    it(`whatsapp ${docType} before any stage asks for payment by the due date`, () => {
      const text = whatsappReminderText({
        businessName: "עסק",
        clientName: "לקוח",
        number: 12,
        total: 3600,
        docType,
        date: "05.07.2026",
        dueDate: "20.07.2026",
        days: -4,
        stage: dunningStageFor(-4),
        viewUrl: "https://example.com/view/x",
      });
      expect(text).toBe(
        `שלום לקוח,\n\n${DUE_PRE[docType]}\n\nכל פרטי התשלום נמצאים במסמך. אם כבר שילמת, אפשר להתעלם מההודעה.\n\nלצפייה במסמך: https://example.com/view/x\n\nתודה,\nעסק`,
      );
    });
  }

  it("leaves no placeholder and no long dash in any due-date variant", () => {
    for (const line of [...Object.values(DUNNING_DUE_INTROS), PRE_STAGE_DUE_INTRO]) {
      for (const dash of LONG_DASHES) expect(line.includes(dash)).toBe(false);
    }
    for (const line of [...Object.values(DUE_EMAIL), ...Object.values(DUE_PRE)]) {
      expect(line).not.toMatch(/[{}]/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* aging                                                               */
/* ------------------------------------------------------------------ */

function agingDoc(over: Partial<InvoiceDocument>): InvoiceDocument {
  return {
    id: "x",
    type: "tax_invoice",
    number: 1,
    date: "2026-01-01",
    clientId: "c1",
    clientName: "א",
    status: "sent",
    items: [],
    subtotal: 0,
    vat: 0,
    total: 100,
    ...over,
  };
}

describe("aging by due date", () => {
  const now = new Date(2026, 8, 16);
  const docs = [
    // Issued 90 days ago, due in 5 days: not late at all.
    agingDoc({ id: "future", date: iso(now, -90), dueDate: iso(now, 5), total: 1000 }),
    // Due today: not late yet either.
    agingDoc({ id: "today", date: iso(now, -40), dueDate: iso(now, 0), total: 50 }),
    // Issued 100 days ago, 10 days past due: bucket 0.
    agingDoc({ id: "late10", type: "proforma", date: iso(now, -100), dueDate: iso(now, -10), total: 200 }),
    // 45 days past due: bucket 1.
    agingDoc({ id: "late45", clientId: "c2", clientName: "ב", date: iso(now, -60), dueDate: iso(now, -45), total: 300 }),
    // No due date, issued 70 days ago: bucket 2 either way.
    agingDoc({ id: "undated", clientId: "c2", clientName: "ב", date: iso(now, -70), total: 400 }),
    // A due date on a type that cannot carry one is ignored.
    agingDoc({ id: "quote", type: "quote", date: iso(now, -5), dueDate: iso(now, 5), total: 999 }),
  ];

  it("keeps a not-yet-due document out of the lateness buckets but in the total", () => {
    const { rows, totals, undatedCount } = computeAging(docs, [], "due", now);
    const c1 = rows.find((r) => r.clientId === "c1")!;
    expect(c1.notYetDue).toBe(1050);
    expect(c1.buckets).toEqual([200, 0, 0, 0]);
    expect(c1.total).toBe(1250);
    const c2 = rows.find((r) => r.clientId === "c2")!;
    expect(c2.notYetDue).toBe(0);
    expect(c2.buckets).toEqual([0, 300, 400, 0]);
    expect(totals.buckets).toHaveLength(4);
    expect(totals.buckets).toEqual([200, 300, 400, 0]);
    expect(totals.notYetDue).toBe(1050);
    expect(totals.grand).toBe(1950);
    expect(totals.grand).toBe(totals.notYetDue + totals.buckets.reduce((a, b) => a + b, 0));
    expect(totals.docCount).toBe(5);
    expect(undatedCount).toBe(1);
  });

  it("ignores due dates entirely under the issue basis", () => {
    const { rows, totals, undatedCount } = computeAging(docs, [], "issue", now);
    expect(totals.notYetDue).toBe(0);
    expect(rows.every((r) => r.notYetDue === 0)).toBe(true);
    // future 90d -> 2, today 40d -> 1, late10 100d -> 3, late45 60d -> 1, undated 70d -> 2
    expect(totals.buckets).toEqual([0, 350, 1400, 200]);
    expect(totals.grand).toBe(1950);
    expect(undatedCount).toBe(0);
  });

  it("defaults to the issue basis when no basis is passed", () => {
    expect(computeAging(docs, []).totals).toEqual(computeAging(docs, [], "issue").totals);
  });

  it("does not count undated documents when every document has a due date", () => {
    expect(computeAging(docs.filter((d) => d.dueDate), [], "due", now).undatedCount).toBe(0);
  });

  it("reports days past due per document", () => {
    expect(daysPastDue(docs[0], now)).toBe(-5);
    expect(daysPastDue(docs[1], now)).toBe(0);
    expect(daysPastDue(docs[2], now)).toBe(10);
    expect(daysPastDue(docs[4], now)).toBe(null);
    expect(daysPastDue(docs[5], now)).toBe(null);
  });

  it("labels the due basis buckets as days of lateness", () => {
    expect(AGING_DUE_BUCKET_LABELS).toEqual(["1-30 ימי איחור", "31-60 ימי איחור", "61-90 ימי איחור", "מעל 90 ימי איחור"]);
    expect(AGING_NOT_YET_DUE_LABEL).toBe("טרם הגיע מועד התשלום");
    expect(AGING_BUCKET_LABELS).toHaveLength(AGING_DUE_BUCKET_LABELS.length);
  });
});

/* ------------------------------------------------------------------ */
/* forecast                                                            */
/* ------------------------------------------------------------------ */

const DUE_SENTENCE = "מסמכים שצוין עליהם מועד תשלום מתוארכים לפי התאריך שעל המסמך.";
const TERMS_SENTENCE = "מסמכים של לקוחות שהוגדרו להם תנאי תשלום מתוארכים לפי התנאים שסוכמו.";
const MEDIAN_SENTENCE = "ללקוחות שלא הוגדרו להם תנאי תשלום, מועד התשלום נאמד לפי חציון ימי התשלום של אותו לקוח בעבר.";
const FALLBACK_SENTENCE = "ללקוחות שאין להם היסטוריית תשלומים הונחו 30 ימים עד לתשלום.";

describe("forecast: the document's own due date", () => {
  const run = (documents: InvoiceDocument[], paymentTerms?: "eom_30") =>
    forecastCashFlow({
      documents,
      expenses: [],
      business: { businessType: "exempt" },
      today: "2026-09-16",
      clients: [{ id: "c1", name: "א", taxId: undefined, paymentTerms }],
    });
  const openLines = (r: ReturnType<typeof run>) =>
    r.months.flatMap((m) => m.lines.filter((l) => l.kind === "open_invoice")).map((l) => [l.documentId, l.date]);

  it("dates a document by its due date ahead of the client's agreed terms", () => {
    const r = run([agingDoc({ id: "d1", date: "2026-09-01", dueDate: "2026-10-05" })], "eom_30");
    expect(openLines(r)).toEqual([["d1", "2026-10-05"]]);
    expect(r.assumptions).toContain(DUE_SENTENCE);
    // The only terms client's document was dated by its own due date.
    expect(r.assumptions).not.toContain(TERMS_SENTENCE);
    expect(r.assumptions).not.toContain(MEDIAN_SENTENCE);
    expect(r.assumptions).not.toContain(FALLBACK_SENTENCE);
  });

  it("moves a past due date to today, like any late document", () => {
    const r = run([agingDoc({ id: "d1", date: "2026-08-01", dueDate: "2026-08-20" })]);
    expect(openLines(r)).toEqual([["d1", "2026-09-16"]]);
  });

  it("falls to the terms tier for a document without a due date, and says both", () => {
    const r = run(
      [
        agingDoc({ id: "d1", date: "2026-09-01", dueDate: "2026-10-05" }),
        agingDoc({ id: "d2", date: "2026-09-01" }),
      ],
      "eom_30",
    );
    expect(openLines(r)).toEqual([["d1", "2026-10-05"], ["d2", "2026-10-30"]]);
    const due = r.assumptions.indexOf(DUE_SENTENCE);
    expect(due).toBeGreaterThanOrEqual(0);
    expect(r.assumptions.indexOf(TERMS_SENTENCE)).toBe(due + 1);
  });

  it("does not emit the sentence when no document states a due date", () => {
    const r = run([agingDoc({ id: "d2", date: "2026-09-01" })]);
    expect(r.assumptions).not.toContain(DUE_SENTENCE);
    expect(r.assumptions).toContain(FALLBACK_SENTENCE);
  });
});

describe("council follow-ups", () => {
  it("rejects a due date that has the right shape but is not a calendar day", () => {
    for (const bad of ["2026-13-45", "2026-02-30", "2027-02-29", "2026-00-10", "2026-04-31"]) {
      expect(usableDueDate(bad)).toBeNull();
    }
    expect(usableDueDate("2028-02-29")).toBe("2028-02-29");
    expect(usableDueDate("2026-12-31")).toBe("2026-12-31");
  });

  it("keeps an impossible due date on the issue-date schedule and out of the email", () => {
    const now = new Date(2026, 7, 24);
    expect(daysLate({ date: "2026-07-05", dueDate: "2026-13-45" }, now)).toBe(
      daysLate({ date: "2026-07-05", dueDate: null }, now),
    );
    const content = dunningEmailContent({
      stage: 14, docType: "tax_invoice", number: 12, total: 3600,
      date: "2026-07-05", dueDate: "2026-13-45", days: 50,
    });
    expect(content.intro).not.toContain("45.13");
    expect(content.intro).not.toContain("מועד התשלום");
  });

  const pre = (days: number) =>
    whatsappReminderText({
      businessName: "עסק", clientName: "לקוח", number: 12, total: 3600,
      docType: "tax_invoice", date: "05.07.2026", dueDate: "20.07.2026",
      days, stage: dunningStageFor(days), viewUrl: "https://x.test/view/1",
    });

  it("asks to be paid by the due date only while that date is not behind the client", () => {
    expect(pre(-5)).toContain("אשמח לתשלום עד 20.07.2026.");
    expect(pre(0)).toContain("אשמח לתשלום עד 20.07.2026.");
    for (const days of [1, 2]) {
      expect(pre(days)).not.toContain("עד 20.07.2026");
      expect(pre(days)).toContain("מ-05.07.2026, אשמח לתשלום.");
    }
  });
});

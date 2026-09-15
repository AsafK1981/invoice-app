import { describe, it, expect } from "vitest";
import { isOpenReceivable, planDunningEmails, type EmailPlanDoc } from "@/lib/dunning-plan";
import { planAssistedReminders } from "@/lib/assisted-dunning";

const TODAY = new Date(2026, 8, 6); // 2026-09-06, local midnight

function doc(over: Partial<EmailPlanDoc> = {}): EmailPlanDoc {
  return {
    id: "doc-1",
    client_id: "cl-1",
    date: "2026-08-20", // 17 days before TODAY -> stage 14
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

const NOT_RECEIVABLE: Array<[string, Partial<EmailPlanDoc>]> = [
  ["a quote", { type: "quote" }],
  ["a receipt", { type: "receipt" }],
  ["a draft", { status: "draft" }],
  ["a cancelled document", { status: "cancelled" }],
  ["a paid status", { status: "paid" }],
  ["a paid date", { paid_at: "2026-08-25T10:00:00Z" }],
  ["a converted document", { converted_to_id: "doc-99" }],
];

describe("isOpenReceivable", () => {
  it("accepts a sent, unpaid tax invoice or proforma", () => {
    expect(isOpenReceivable(doc())).toBe(true);
    expect(isOpenReceivable(doc({ type: "proforma" }))).toBe(true);
  });

  for (const [label, over] of NOT_RECEIVABLE) {
    it(`rejects ${label}`, () => {
      expect(isOpenReceivable(doc(over))).toBe(false);
    });
  }
});

describe("planDunningEmails", () => {
  it("queues an overdue receivable with a client email at its stage", () => {
    const { queue, skipped, noEmail } = planDunningEmails([doc()], EMAILS, [], TODAY);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ stage: 14, days: 17, email: "client@example.com" });
    expect(skipped).toBe(0);
    expect(noEmail).toHaveLength(0);
  });

  it("never emails a quote, a converted document, a draft or a cancelled one", () => {
    const docs = NOT_RECEIVABLE.map(([label, over]) => doc({ id: label, ...over }));
    const { queue, skipped } = planDunningEmails(docs, EMAILS, [], TODAY);
    expect(queue).toHaveLength(0);
    expect(skipped).toBe(docs.length);
  });

  it("applies the same receivable rule as the assisted WhatsApp pass", () => {
    const docs = [
      doc(),
      ...NOT_RECEIVABLE.map(([label, over]) => doc({ id: label, ...over })),
    ].map((d) => ({ ...d, client_name: "x", number: 1, total: 1 }));
    const emailIds = planDunningEmails(docs, EMAILS, [], TODAY).queue.map((p) => p.doc.id);
    const waIds = planAssistedReminders(docs, [{ id: "cl-1", phone: "054-900-0684" }], [], TODAY).map(
      (p) => p.documentId,
    );
    expect(emailIds).toEqual(waIds);
    expect(emailIds).toEqual(["doc-1"]);
  });

  it("dedupes on email-channel rows only, treating a null channel as email", () => {
    expect(
      planDunningEmails([doc()], EMAILS, [{ document_id: "doc-1", day_bucket: 14, channel: null }], TODAY).queue,
    ).toHaveLength(0);
    expect(
      planDunningEmails([doc()], EMAILS, [{ document_id: "doc-1", day_bucket: 14, channel: "email" }], TODAY).queue,
    ).toHaveLength(0);
    expect(
      planDunningEmails(
        [doc()],
        EMAILS,
        [{ document_id: "doc-1", day_bucket: 14, channel: "whatsapp_assist" }],
        TODAY,
      ).queue,
    ).toHaveLength(1);
  });

  it("waits for day 3", () => {
    const { queue, skipped } = planDunningEmails([doc({ date: "2026-09-05" })], EMAILS, [], TODAY);
    expect(queue).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("reports a due document whose client has no email", () => {
    const docs = [doc({ id: "no-email", client_id: "cl-2" }), doc({ id: "unlinked", client_id: null })];
    const { queue, noEmail, skipped } = planDunningEmails(docs, EMAILS, [], TODAY);
    expect(queue).toHaveLength(0);
    expect(skipped).toBe(2);
    expect(noEmail.map((n) => [n.doc.id, n.stage])).toEqual([
      ["no-email", 14],
      ["unlinked", 14],
    ]);
  });
});

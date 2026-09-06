import { describe, it, expect } from "vitest";
import {
  WHATSAPP_ASSIST_CHANNEL,
  planAssistedReminders,
  type AssistedClientRow,
  type AssistedDocRow,
  type AssistedLogRow,
} from "@/lib/assisted-dunning";

const TODAY = new Date(2026, 8, 6); // 2026-09-06, local midnight

function doc(over: Partial<AssistedDocRow> = {}): AssistedDocRow {
  return {
    id: "doc-1",
    client_id: "cl-1",
    client_name: "דני לוי",
    number: 137,
    date: "2026-08-20", // 17 days before TODAY -> stage 14
    total: 2340,
    type: "tax_invoice",
    status: "sent",
    paid_at: null,
    converted_to_id: null,
    ...over,
  };
}

const CLIENTS: AssistedClientRow[] = [
  { id: "cl-1", phone: "054-900-0684" },
  { id: "cl-2", phone: null },
  { id: "cl-3", phone: "0549" },
];

describe("planAssistedReminders", () => {
  it("plans one reminder for an overdue receivable whose client has a phone", () => {
    const plans = planAssistedReminders([doc()], CLIENTS, [], TODAY);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      documentId: "doc-1",
      stage: 14,
      days: 17,
      phone: "972549000684",
      href: "/documents/doc-1?remind=whatsapp",
    });
    expect(plans[0].title).toContain("חשבונית מס #137");
    expect(plans[0].title).toContain("דני לוי");
    expect(plans[0].title).toContain("17 ימים");
    expect(plans[0].body).toBe("לחצו כדי לשלוח תזכורת בוואטסאפ מהמספר שלכם");
  });

  it("plans once per (document, stage) and again when the next stage arrives", () => {
    const logs: AssistedLogRow[] = [
      { document_id: "doc-1", day_bucket: 3, channel: WHATSAPP_ASSIST_CHANNEL },
    ];
    // Day 3 already prepared, now at day 17: the day-14 reminder is due.
    expect(planAssistedReminders([doc()], CLIENTS, logs, TODAY)).toHaveLength(1);
    // Once day 14 is logged too, nothing more until day 30.
    logs.push({ document_id: "doc-1", day_bucket: 14, channel: WHATSAPP_ASSIST_CHANNEL });
    expect(planAssistedReminders([doc()], CLIENTS, logs, TODAY)).toHaveLength(0);
  });

  it("ignores the email channel's log rows", () => {
    const logs: AssistedLogRow[] = [
      { document_id: "doc-1", day_bucket: 14, channel: "email" },
      { document_id: "doc-1", day_bucket: 14, channel: null },
    ];
    expect(planAssistedReminders([doc()], CLIENTS, logs, TODAY)).toHaveLength(1);
  });

  it("skips clients with no phone, or a number too short to dial", () => {
    const docs = [
      doc({ id: "no-phone", client_id: "cl-2" }),
      doc({ id: "bad-phone", client_id: "cl-3" }),
      doc({ id: "unlinked", client_id: null }),
    ];
    expect(planAssistedReminders(docs, CLIENTS, [], TODAY)).toHaveLength(0);
  });

  it("skips anything that is not an open receivable", () => {
    const docs = [
      doc({ id: "quote", type: "quote" }),
      doc({ id: "receipt", type: "receipt" }),
      doc({ id: "draft", status: "draft" }),
      doc({ id: "cancelled", status: "cancelled" }),
      doc({ id: "paid-status", status: "paid" }),
      doc({ id: "paid-at", paid_at: "2026-08-25T10:00:00Z" }),
      doc({ id: "converted", converted_to_id: "doc-99" }),
    ];
    expect(planAssistedReminders(docs, CLIENTS, [], TODAY)).toHaveLength(0);
  });

  it("waits for day 3 and follows the document into the later stages", () => {
    const at = (date: string) => planAssistedReminders([doc({ date })], CLIENTS, [], TODAY);
    expect(at("2026-09-05")).toHaveLength(0); // 1 day
    expect(at("2026-09-03")[0].stage).toBe(3); // 3 days
    expect(at("2026-08-23")[0].stage).toBe(14); // 14 days
    expect(at("2026-08-07")[0].stage).toBe(30); // 30 days
    expect(at("2026-01-01")[0].stage).toBe(30); // long overdue stays at 30
  });

  it("plans for a proforma the same way it does for a tax invoice", () => {
    const plans = planAssistedReminders([doc({ type: "proforma" })], CLIENTS, [], TODAY);
    expect(plans).toHaveLength(1);
    expect(plans[0].stage).toBe(14);
    // The title names the document for what it is, not "חשבונית" for all.
    expect(plans[0].title).toContain("חשבון עסקה #137");
  });
});

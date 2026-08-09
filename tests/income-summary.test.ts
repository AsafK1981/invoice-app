import { describe, it, expect } from "vitest";
import { summarizeIncome, type IncomeRow } from "@/lib/income-summary";

function row(over: Partial<IncomeRow> = {}): IncomeRow {
  return {
    type: "receipt",
    status: "paid",
    total: 100,
    client_name: "לקוח",
    converted_to_id: null,
    ...over,
  };
}

describe("summarizeIncome", () => {
  it("counts paid revenue documents", () => {
    const s = summarizeIncome([
      row({ total: 100 }),
      row({ type: "tax_invoice", total: 50 }),
      row({ type: "tax_invoice_receipt", total: 25 }),
    ]);
    expect(s.total).toBe(175);
    expect(s.documentCount).toBe(3);
  });

  it("excludes unpaid documents of every type", () => {
    const s = summarizeIncome([
      row({ status: "sent" }),
      row({ status: "draft" }),
      row({ status: "cancelled" }),
    ]);
    expect(s.total).toBe(0);
    expect(s.documentCount).toBe(0);
  });

  // The regression the coding council caught on 2026-08-08: the assistant's
  // first income tool counted credit notes without a status check, while every
  // revenue screen requires paid for credit notes too. A freshly created
  // credit note defaults to "sent", so the mismatch was immediate, not
  // theoretical.
  it("ignores an unpaid (sent) credit note - the 2026-08-08 council bug", () => {
    const s = summarizeIncome([
      row({ total: 100 }),
      row({ type: "credit_note", status: "sent", total: -40 }),
    ]);
    expect(s.total).toBe(100);
    expect(s.documentCount).toBe(1);
  });

  // Credit notes are STORED negative (receipt-editor applies sign = -1 to
  // subtotal/vat/total). An earlier version of summarizeIncome negated them
  // again, so a refund increased reported income - and the first version of
  // this test hid it by using a positive 40, which the app never writes.
  // Fixtures here must carry the sign the database actually holds.
  it("subtracts a paid credit note, which is stored negative", () => {
    const s = summarizeIncome([
      row({ total: 100 }),
      row({ type: "credit_note", status: "paid", total: -40 }),
    ]);
    expect(s.total).toBe(60);
    expect(s.documentCount).toBe(2);
  });

  it("prefers total_ils so foreign-currency documents are not summed as shekels", () => {
    // A $100 invoice at ~3.7 is ₪370, not ₪100.
    const s = summarizeIncome([row({ total: 100, total_ils: 370 })]);
    expect(s.total).toBe(370);
  });

  it("falls back to total when total_ils is null (ILS documents)", () => {
    const s = summarizeIncome([row({ total: 250, total_ils: null })]);
    expect(s.total).toBe(250);
  });

  it("excludes converted documents (already counted via their successor)", () => {
    const s = summarizeIncome([
      row({ total: 100 }),
      row({ type: "proforma", status: "paid", total: 100, converted_to_id: "abc" }),
    ]);
    expect(s.total).toBe(100);
    expect(s.documentCount).toBe(1);
  });

  it("never counts quotes or proformas even when paid", () => {
    const s = summarizeIncome([
      row({ type: "quote", status: "paid", total: 500 }),
      row({ type: "proforma", status: "paid", total: 500 }),
    ]);
    expect(s.total).toBe(0);
  });

  it("ranks clients by net amount and caps the list", () => {
    const s = summarizeIncome(
      [
        row({ client_name: "א", total: 10 }),
        row({ client_name: "ב", total: 30 }),
        row({ client_name: "ב", type: "credit_note", status: "paid", total: -25 }),
        row({ client_name: "ג", total: 20 }),
      ],
      2,
    );
    expect(s.topClients).toEqual([
      { client: "ג", amount: 20 },
      { client: "א", amount: 10 },
    ]);
  });

  it("survives junk totals and a missing client name", () => {
    const s = summarizeIncome([
      row({ total: "not-a-number" }),
      row({ total: 55.555, client_name: null }),
    ]);
    expect(s.total).toBe(55.56);
    expect(s.topClients[0].client).toBe("ללא לקוח");
  });
});

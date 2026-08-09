import { describe, it, expect } from "vitest";
import { buildMonthlyReminder, type MonthlyReminderDoc } from "@/lib/monthly-reminder";

/**
 * `now` is fixed mid-August so "this month" = 2026-08 and "last month" =
 * 2026-07 regardless of when the suite runs.
 */
const NOW = new Date("2026-08-15T09:00:00.000Z");

function doc(overrides: Partial<MonthlyReminderDoc>): MonthlyReminderDoc {
  return {
    id: "doc-1",
    type: "tax_invoice",
    status: "paid",
    date: "2026-08-10",
    number: 1,
    clientName: "לקוח לדוגמה",
    total: 1000,
    ...overrides,
  };
}

describe("buildMonthlyReminder", () => {
  it("returns null when the business already issued a document this month and nothing is open", () => {
    const result = buildMonthlyReminder(
      [doc({ id: "a", date: "2026-08-01", status: "paid" })],
      NOW,
    );
    expect(result).toBeNull();
  });

  it("includes an open quote even if a document was already issued this month", () => {
    const result = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-08-01", status: "paid" }),
        doc({
          id: "b",
          type: "quote",
          status: "sent",
          date: "2026-08-05",
          number: 201,
          clientName: "לקוח פתוח",
          total: 500,
        }),
      ],
      NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.openItems).toHaveLength(1);
    expect(result!.openItems[0].clientName).toBe("לקוח פתוח");
    expect(result!.openItems[0].amount).toBe(500);
  });

  it("flags a retainer client who had a document last month but none this month", () => {
    const result = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-08-01", status: "paid", clientName: "לקוח א" }),
        doc({ id: "b", date: "2026-07-10", status: "paid", clientName: "לקוח קבוע" }),
      ],
      NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.missingRetainerClients).toEqual(["לקוח קבוע"]);
  });

  it("matches retainer clients by clientId, not by name, so two different clients sharing a display name don't collide", () => {
    const result = buildMonthlyReminder(
      [
        // Issued this month, but a DIFFERENT client that happens to share a name.
        doc({
          id: "a",
          date: "2026-08-01",
          status: "paid",
          clientId: "client-2",
          clientName: "ישראל ישראלי",
        }),
        // Last month's client with the same display name but a different id -
        // should still be flagged as missing, since it's not the same client.
        doc({
          id: "b",
          date: "2026-07-10",
          status: "paid",
          clientId: "client-1",
          clientName: "ישראל ישראלי",
        }),
      ],
      NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.missingRetainerClients).toEqual(["ישראל ישראלי"]);
  });

  it("returns a summary when there are no documents at all this month", () => {
    const result = buildMonthlyReminder(
      [doc({ id: "a", date: "2026-06-01", status: "paid" })],
      NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.documentsThisMonthCount).toBe(0);
  });

  it("does not let a real credit_note show up in openItems or unpaidCount", () => {
    const result = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-08-01", status: "paid" }),
        doc({
          id: "b",
          type: "credit_note",
          status: "sent",
          date: "2026-08-02",
          number: 202,
          clientName: "לקוח זיכוי",
          total: -300,
          totalIls: -300,
        }),
      ],
      NOW,
    );
    // A credit_note is neither a quote/proforma (openItems) nor counted in
    // unpaidCount (quote/proforma/tax_invoice only) - it should be invisible
    // to this reminder entirely.
    expect(result).toBeNull();
  });

  it("sums a negative total via totalIls ?? total on an open quote without renegating it", () => {
    const result = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-08-01", status: "paid" }),
        doc({
          id: "b",
          type: "quote",
          status: "sent",
          date: "2026-08-02",
          number: 202,
          clientName: "לקוח קרדיט",
          total: -300,
          totalIls: -300,
        }),
      ],
      NOW,
    );
    expect(result).not.toBeNull();
    const item = result!.openItems.find((i) => i.clientName === "לקוח קרדיט");
    expect(item?.amount).toBe(-300);
  });

  it("counts unpaid sent documents (quote/proforma/tax_invoice) without paidAt", () => {
    const result = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-07-01", status: "paid", clientName: "לקוח א" }),
        doc({
          id: "b",
          type: "tax_invoice",
          status: "sent",
          date: "2026-08-03",
          number: 300,
          clientName: "לקוח לא שילם",
          total: 700,
          paidAt: null,
        }),
      ],
      NOW,
    );
    // Not null because "לקוח א" (last month) never appears this month, which
    // alone is enough to produce a summary; unpaidCount is independent of
    // that and reflects the one sent-but-unpaid tax invoice.
    expect(result).not.toBeNull();
    expect(result!.unpaidCount).toBe(1);
  });

  it("excludes drafts from the issued-this-month and issued-last-month counts", () => {
    const result = buildMonthlyReminder(
      [
        // Only a draft this month - should NOT count as "issued", so the
        // business still gets a reminder even though a row exists.
        doc({ id: "a", date: "2026-08-05", status: "draft" }),
      ],
      NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.documentsThisMonthCount).toBe(0);
  });

  it("does not flag a retainer client whose only last-month document was a draft", () => {
    const result = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-08-01", status: "paid", clientName: "לקוח א" }),
        doc({ id: "b", date: "2026-07-10", status: "draft", clientName: "לקוח טיוטה" }),
      ],
      NOW,
    );
    // The draft never "issued" anything last month, so there's nothing to
    // miss this month - the client shouldn't be flagged as a lapsed
    // retainer. Combined with a document issued this month and no open
    // items, there's nothing left to nudge about at all.
    expect(result).toBeNull();
  });

  it("still includes an open draft quote in openItems (unfinished work, not excluded)", () => {
    const result = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-08-01", status: "paid" }),
        doc({
          id: "b",
          type: "quote",
          status: "draft",
          date: "2026-08-05",
          number: 401,
          clientName: "לקוח טיוטה פתוחה",
          total: 250,
        }),
      ],
      NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.openItems.some((i) => i.clientName === "לקוח טיוטה פתוחה")).toBe(true);
  });

  it("computes the previous month via string arithmetic, not Date#setMonth overflow (Mar 31 -> Feb)", () => {
    const marchEnd = new Date("2026-03-31T09:00:00.000Z");
    const result = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-03-01", status: "paid", clientName: "לקוח מרץ" }),
        doc({ id: "b", date: "2026-02-15", status: "paid", clientName: "לקוח פברואר" }),
      ],
      marchEnd,
    );
    expect(result).not.toBeNull();
    expect(result!.missingRetainerClients).toEqual(["לקוח פברואר"]);
  });

  it("rolls the year backward when the previous month is January (Jan -> Dec of prior year)", () => {
    const januaryDate = new Date("2026-01-10T09:00:00.000Z");
    const result = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-01-01", status: "paid", clientName: "לקוח ינואר" }),
        doc({ id: "b", date: "2025-12-20", status: "paid", clientName: "לקוח דצמבר" }),
      ],
      januaryDate,
    );
    expect(result).not.toBeNull();
    expect(result!.missingRetainerClients).toEqual(["לקוח דצמבר"]);
  });
});

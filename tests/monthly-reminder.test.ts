import { describe, it, expect } from "vitest";
import {
  buildMonthlyReminder,
  issuedSentence,
  missingRetainerHeading,
  notificationBody,
  unpaidSentence,
  type MonthlyReminderDoc,
  type MonthlyReminderSummary,
} from "@/lib/monthly-reminder";

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

  it("leaves a draft quote out of openItems, so it cannot block the nothing-to-report skip", () => {
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
    expect(result).toBeNull();
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

  it("ignores open quotes older than the 60-day window, so years-old quotes do not force a reminder", () => {
    const result = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-08-01", status: "paid" }),
        doc({ id: "old", type: "quote", status: "sent", date: "2023-02-01", clientName: "הצעה ישנה" }),
        doc({ id: "edge", type: "quote", status: "sent", date: "2026-06-15", clientName: "הצעה בקצה" }),
      ],
      NOW,
    );
    // 2026-06-16 is exactly 60 days before 2026-08-15, so 06-15 is outside too.
    expect(result).toBeNull();
    const inside = buildMonthlyReminder(
      [
        doc({ id: "a", date: "2026-08-01", status: "paid" }),
        doc({ id: "recent", type: "quote", status: "sent", date: "2026-06-16", clientName: "הצעה עדכנית" }),
      ],
      NOW,
    );
    expect(inside!.openItems.map((i) => i.clientName)).toEqual(["הצעה עדכנית"]);
  });

  it("does not count a sent quote as unpaid", () => {
    const result = buildMonthlyReminder(
      [
        doc({ id: "q", type: "quote", status: "sent", date: "2026-08-05", paidAt: null }),
        doc({ id: "p", type: "proforma", status: "sent", date: "2026-08-06", paidAt: null }),
      ],
      NOW,
    );
    expect(result!.unpaidCount).toBe(1);
  });

  it("on the 1st compares last month against the month before it, not against the brand-new month", () => {
    const first = new Date("2026-09-01T06:00:00.000Z");
    const docs = [
      doc({ id: "a", date: "2026-08-10", status: "paid", clientId: "c1", clientName: "לקוח קבוע" }),
      doc({ id: "b", date: "2026-07-10", status: "paid", clientId: "c1", clientName: "לקוח קבוע" }),
    ];
    // Billed in August as in July: nothing is missing, and August had a document.
    expect(buildMonthlyReminder(docs, first)).toBeNull();

    const lapsed = buildMonthlyReminder(
      [...docs, doc({ id: "c", date: "2026-07-12", status: "paid", clientId: "c2", clientName: "לקוח שנעלם" })],
      first,
    );
    expect(lapsed!.reportsPreviousMonth).toBe(true);
    expect(lapsed!.missingRetainerClients).toEqual(["לקוח שנעלם"]);
    expect(lapsed!.documentsThisMonthCount).toBe(1);
    expect(lapsed!.periodLabel).toBe("אוגוסט 2026");
    expect(issuedSentence(lapsed!)).toBe("באוגוסט 2026 הוצאתם מסמך אחד.");
    expect(missingRetainerHeading(lapsed!)).toBe("לקוחות שקיבלו מסמך ביולי 2026 אך לא באוגוסט 2026:");

    // From the 4th on, the report is about the current month again.
    const fourth = buildMonthlyReminder(docs, new Date("2026-09-04T06:00:00.000Z"));
    expect(fourth!.reportsPreviousMonth).toBe(false);
    expect(fourth!.missingRetainerClients).toEqual(["לקוח קבוע"]);
  });
});

describe("monthly reminder wording", () => {
  const base: MonthlyReminderSummary = {
    periodLabel: "ספטמבר 2026",
    previousPeriodLabel: "אוגוסט 2026",
    reportsPreviousMonth: false,
    documentsThisMonthCount: 1,
    openItems: [{ id: "x", type: "quote", number: 1, clientName: "א", amount: 1 }],
    missingRetainerClients: [],
    unpaidCount: 1,
  };

  it("uses singular forms for one", () => {
    expect(issuedSentence(base)).toBe("החודש הוצאתם מסמך אחד.");
    expect(unpaidSentence(base)).toBe("יש מסמך אחד שטרם שולם.");
    expect(notificationBody(base)).toBe("מסמך אחד החודש, פתוח אחד.");
  });

  it("uses plural forms and a plain zero sentence", () => {
    const many = { ...base, documentsThisMonthCount: 3, unpaidCount: 4, openItems: [...base.openItems, ...base.openItems] };
    expect(issuedSentence(many)).toBe("החודש הוצאתם 3 מסמכים.");
    expect(unpaidSentence(many)).toBe("יש 4 מסמכים שטרם שולמו.");
    expect(notificationBody(many)).toBe("3 מסמכים החודש, 2 פתוחים.");
    expect(issuedSentence({ ...base, documentsThisMonthCount: 0 })).toBe("החודש לא הוצאתם מסמכים.");
    expect(unpaidSentence({ ...base, unpaidCount: 0 })).toBe("");
  });
});

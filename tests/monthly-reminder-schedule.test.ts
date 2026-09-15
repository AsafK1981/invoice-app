import { describe, it, expect } from "vitest";
import {
  shouldSendMonthlyReminder,
  nextReminderOccurrence,
  sanitizeReminderDays,
  clampDayToMonth,
} from "@/lib/reminder-schedule";

describe("sanitizeReminderDays", () => {
  it("drops invalid entries, dedupes, sorts, and caps at 3", () => {
    expect(sanitizeReminderDays([15, 1, 1, 0, 32, "abc", 8, 20, 25])).toEqual([1, 8, 15]);
  });

  it("returns an empty array for non-array input", () => {
    expect(sanitizeReminderDays(null)).toEqual([]);
    expect(sanitizeReminderDays(undefined)).toEqual([]);
  });
});

describe("clampDayToMonth", () => {
  it("clamps day 31 down in a 30-day month", () => {
    expect(clampDayToMonth(2026, 4, 31)).toBe(30); // April
  });

  it("clamps day 31 down in February (non-leap 2026)", () => {
    expect(clampDayToMonth(2026, 2, 31)).toBe(28);
  });

  it("clamps day 31 down in February of a leap year", () => {
    expect(clampDayToMonth(2028, 2, 31)).toBe(29);
  });

  it("leaves an in-range day untouched", () => {
    expect(clampDayToMonth(2026, 8, 15)).toBe(15);
  });
});

describe("shouldSendMonthlyReminder", () => {
  it("(a) fires exactly on the chosen day at the chosen hour", () => {
    expect(
      shouldSendMonthlyReminder({
        days: [1],
        hour: 9,
        lastSent: null,
        todayIsrael: "2026-08-01",
        currentHourIsrael: 9,
      }),
    ).toBe(true);
  });

  it("(b) does not fire on the chosen day before the chosen hour", () => {
    expect(
      shouldSendMonthlyReminder({
        days: [1],
        hour: 9,
        lastSent: null,
        todayIsrael: "2026-08-01",
        currentHourIsrael: 8,
      }),
    ).toBe(false);
  });

  it("(c) fires later the same day (catch-up on a missed exact hour)", () => {
    expect(
      shouldSendMonthlyReminder({
        days: [1],
        hour: 9,
        lastSent: null,
        todayIsrael: "2026-08-01",
        currentHourIsrael: 14,
      }),
    ).toBe(true);
  });

  it("(d) day 31 clamps to the last day of a 30-day month (April)", () => {
    // Chosen day 31, but April only has 30 - should fire on the 30th.
    expect(
      shouldSendMonthlyReminder({
        days: [31],
        hour: 9,
        lastSent: null,
        todayIsrael: "2026-04-30",
        currentHourIsrael: 9,
      }),
    ).toBe(true);
    // And not one day earlier, the 29th - the clamped date hasn't arrived yet.
    expect(
      shouldSendMonthlyReminder({
        days: [31],
        hour: 9,
        lastSent: null,
        todayIsrael: "2026-04-29",
        currentHourIsrael: 12,
      }),
    ).toBe(false);
  });

  it("(d) day 31 clamps to the 28th in February (non-leap 2026)", () => {
    expect(
      shouldSendMonthlyReminder({
        days: [31],
        hour: 9,
        lastSent: null,
        todayIsrael: "2026-02-28",
        currentHourIsrael: 9,
      }),
    ).toBe(true);
  });

  it("(e) two chosen days both fire in the same month - the first's last_sent doesn't block the second", () => {
    // last_sent stamped from the 1st firing.
    expect(
      shouldSendMonthlyReminder({
        days: [1, 15],
        hour: 9,
        lastSent: "2026-08-01",
        todayIsrael: "2026-08-15",
        currentHourIsrael: 9,
      }),
    ).toBe(true);
  });

  it("(f) last_sent on-or-after the scheduled date blocks re-sending the same date", () => {
    expect(
      shouldSendMonthlyReminder({
        days: [1],
        hour: 9,
        lastSent: "2026-08-01",
        todayIsrael: "2026-08-01",
        currentHourIsrael: 20,
      }),
    ).toBe(false);
    // A last_sent stamp strictly after the scheduled date also blocks (e.g.
    // a skipped-but-stamped evaluation on a later hour of the same day).
    expect(
      shouldSendMonthlyReminder({
        days: [1],
        hour: 9,
        lastSent: "2026-08-01",
        todayIsrael: "2026-08-02",
        currentHourIsrael: 9,
      }),
    ).toBe(false);
  });

  it("(g) a missed day is caught up later in the month only when the last send proves the schedule was running", () => {
    // Sent on the 1st of July, the 1st of August was missed (outage): catch up.
    expect(
      shouldSendMonthlyReminder({
        days: [1],
        hour: 9,
        lastSent: "2026-07-01",
        todayIsrael: "2026-08-05",
        currentHourIsrael: 3,
      }),
    ).toBe(true);
    // Never sent: a day that passed before the reminder existed is not "missed".
    expect(
      shouldSendMonthlyReminder({
        days: [1],
        hour: 9,
        lastSent: null,
        todayIsrael: "2026-08-05",
        currentHourIsrael: 3,
      }),
    ).toBe(false);
  });

  it("(h) fires again next month after a previous month's last_sent", () => {
    expect(
      shouldSendMonthlyReminder({
        days: [1],
        hour: 9,
        lastSent: "2026-07-01",
        todayIsrael: "2026-08-01",
        currentHourIsrael: 9,
      }),
    ).toBe(true);
  });

  it("returns false when the chosen day hasn't arrived yet this month", () => {
    expect(
      shouldSendMonthlyReminder({
        days: [15],
        hour: 9,
        lastSent: null,
        todayIsrael: "2026-08-05",
        currentHourIsrael: 9,
      }),
    ).toBe(false);
  });

  it("returns false when days is empty", () => {
    expect(
      shouldSendMonthlyReminder({
        days: [],
        hour: 9,
        lastSent: null,
        todayIsrael: "2026-08-05",
        currentHourIsrael: 9,
      }),
    ).toBe(false);
  });

  describe("month-rollover catch-up", () => {
    it("a Dec 31 failure (never sent) fires on Jan 1", () => {
      // Chosen day 31, last successful send was Nov 30 - Dec's send never
      // happened (app down through month end). Jan 1 has no candidate day
      // of its own yet (31 hasn't arrived), so the previous month's (Dec)
      // unresolved obligation should fire immediately, any hour.
      expect(
        shouldSendMonthlyReminder({
          days: [31],
          hour: 9,
          lastSent: "2026-11-30",
          todayIsrael: "2026-12-31",
          currentHourIsrael: 23,
        }),
      ).toBe(true); // sanity: Dec 31 itself still fires normally first
      expect(
        shouldSendMonthlyReminder({
          days: [31],
          hour: 9,
          lastSent: "2026-11-30",
          todayIsrael: "2027-01-01",
          currentHourIsrael: 3,
        }),
      ).toBe(true);
    });

    it("does not refire once the previous month was already sent", () => {
      expect(
        shouldSendMonthlyReminder({
          days: [31],
          hour: 9,
          lastSent: "2026-12-31",
          todayIsrael: "2027-01-01",
          currentHourIsrael: 15,
        }),
      ).toBe(false);
    });

    it("handles the year rollover (Dec -> Jan) when computing the previous month", () => {
      expect(
        shouldSendMonthlyReminder({
          days: [15],
          hour: 9,
          lastSent: "2026-11-15",
          todayIsrael: "2027-01-05",
          currentHourIsrael: 0,
        }),
      ).toBe(true); // Dec 15 was missed, lastSent still stuck on Nov
      expect(
        shouldSendMonthlyReminder({
          days: [15],
          hour: 9,
          lastSent: "2026-12-15",
          todayIsrael: "2027-01-05",
          currentHourIsrael: 0,
        }),
      ).toBe(false); // Dec 15 was already sent - no catch-up owed
    });

    it("does not catch up for a brand-new (never-sent) business whose day hasn't arrived this month", () => {
      // lastSent null with no track record must not be treated as an
      // unresolved previous-month obligation - it's simply "not yet due".
      expect(
        shouldSendMonthlyReminder({
          days: [15],
          hour: 9,
          lastSent: null,
          todayIsrael: "2026-08-05",
          currentHourIsrael: 9,
        }),
      ).toBe(false);
    });
  });
});

function ymd(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Walks the cron hour by hour from `from` (inclusive) and returns the first tick that sends. */
function firstSendFrom(days: number[], hour: number, lastSent: string | null, from: string, maxDays = 62): string | null {
  const [y, m, d] = from.split("-").map(Number);
  for (let i = 0; i < maxDays; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    const today = date.toISOString().slice(0, 10);
    for (let h = i === 0 ? 12 : 0; h < 24; h++) {
      if (shouldSendMonthlyReminder({ days, hour, lastSent, todayIsrael: today, currentHourIsrael: h })) {
        return `${today} ${h}`;
      }
    }
  }
  return null;
}

describe("settings changed mid-month (no settings-changed-at column)", () => {
  it("enabled on the 20th with day 1 and never sent: nothing until the 1st of next month", () => {
    expect(firstSendFrom([1], 9, null, "2026-09-20")).toBe("2026-10-01 9");
    expect(ymd(nextReminderOccurrence([1], 9, "2026-09-20", 12, null))).toBe("2026-10-01");
  });

  it("last sent 25.08, day changed from 25 to 5 on 10.09: next send is 5.10", () => {
    expect(firstSendFrom([5], 9, "2026-08-25", "2026-09-10")).toBe("2026-10-05 9");
    expect(ymd(nextReminderOccurrence([5], 9, "2026-09-10", 12, "2026-08-25"))).toBe("2026-10-05");
  });

  it("the preview says today when the cron is about to send today", () => {
    // Chosen day is today, hour already passed, never sent: the next tick sends.
    expect(shouldSendMonthlyReminder({ days: [15], hour: 9, lastSent: null, todayIsrael: "2026-09-15", currentHourIsrael: 14 })).toBe(true);
    expect(ymd(nextReminderOccurrence([15], 9, "2026-09-15", 14, null))).toBe("2026-09-15");
    // Already sent today: the preview moves to next month.
    expect(ymd(nextReminderOccurrence([15], 20, "2026-09-15", 14, "2026-09-15"))).toBe("2026-10-15");
  });

  it("a genuine outage right after a normal send is still caught up", () => {
    expect(firstSendFrom([5], 9, "2026-08-05", "2026-09-10")).toBe("2026-09-10 12");
    // A catch-up stamped two days late still counts as evidence.
    expect(firstSendFrom([5], 9, "2026-08-07", "2026-09-10")).toBe("2026-09-10 12");
  });
});

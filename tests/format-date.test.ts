import { describe, it, expect } from "vitest";
import { formatDate, formatMonth } from "@/lib/format";

/**
 * Document dates are legal data on a tax document. A "YYYY-MM-DD" value must
 * print as the SAME calendar day no matter what timezone the runtime is in
 * (browser in Jerusalem, Vercel lambda in UTC, a dev machine west of UTC).
 */
describe("formatDate", () => {
  const withTZ = (tz: string, fn: () => void) => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      fn();
    } finally {
      process.env.TZ = prev;
    }
  };

  it("formats a calendar date as DD.MM.YYYY", () => {
    expect(formatDate("2026-07-05")).toBe("05.07.2026");
    expect(formatDate("2026-01-01")).toBe("01.01.2026");
    expect(formatDate("2026-12-31")).toBe("31.12.2026");
  });

  it("never shifts a calendar date by a timezone", () => {
    // These are the timezones that used to break it (anything behind UTC) and
    // the ones that must keep working.
    for (const tz of ["UTC", "Asia/Jerusalem", "America/Los_Angeles", "Pacific/Honolulu", "Pacific/Kiritimati"]) {
      withTZ(tz, () => {
        expect(formatDate("2026-07-05"), `TZ=${tz}`).toBe("05.07.2026");
        expect(formatDate("2026-01-01"), `TZ=${tz}`).toBe("01.01.2026");
      });
    }
  });

  it("renders full ISO instants in Israel time", () => {
    // 2026-07-05T22:30:00Z is already 2026-07-06 01:30 in Jerusalem (UTC+3).
    expect(formatDate("2026-07-05T22:30:00Z")).toBe("06.07.2026");
    // 2026-07-05T00:30:00Z is 03:30 on the same day in Jerusalem.
    expect(formatDate("2026-07-05T00:30:00Z")).toBe("05.07.2026");
    // Winter: UTC+2.
    expect(formatDate("2026-01-05T21:30:00Z")).toBe("05.01.2026");
    expect(formatDate("2026-01-05T22:30:00Z")).toBe("06.01.2026");
  });

  it("returns unparseable input untouched instead of 'Invalid Date'", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("not a date")).toBe("not a date");
  });
});

describe("formatMonth", () => {
  it("names the month of a calendar date without drifting", () => {
    expect(formatMonth("2026-07-01")).toContain("2026");
    expect(formatMonth("2026-01-01")).toBe(formatMonth("2026-01-31"));
    // The classic off-by-one: the 1st of a month must not fall back to the
    // previous month.
    expect(formatMonth("2026-08-01")).not.toBe(formatMonth("2026-07-01"));
  });
});

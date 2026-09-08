import { describe, expect, it } from "vitest";
import { formatIsraelDateTime, parseIsraeliDate } from "@/lib/date";

describe("Israeli date entry", () => {
  it("parses day-first dates and rejects impossible dates without rollover", () => {
    expect(parseIsraeliDate("8.9.2026")).toBe("2026-09-08");
    expect(parseIsraeliDate("08/09/2026")).toBe("2026-09-08");
    expect(parseIsraeliDate("29.02.2024")).toBe("2024-02-29");
    for (const value of ["29.02.2026", "31.04.2026", "00.09.2026", "08.13.2026", "2026-09-08", "9/8/26"]) {
      expect(parseIsraeliDate(value)).toBeNull();
    }
  });
  it("keeps date and time in Jerusalem through midnight and DST", () => {
    for (const timezone of ["America/Los_Angeles", "UTC", "Asia/Jerusalem"]) {
      const original = process.env.TZ;
      process.env.TZ = timezone;
      try {
        expect(formatIsraelDateTime("2026-09-08T22:30:00Z")).toBe("09.09.2026 · 01:30");
        expect(formatIsraelDateTime("2026-01-08T22:30:00Z")).toBe("09.01.2026 · 00:30");
      } finally { process.env.TZ = original; }
    }
  });
});

import { describe, it, expect } from "vitest";
import { formatDate, formatTime, israelClock } from "@/lib/uniform-structure/encode";
import { uniformFolderPath } from "@/lib/uniform-structure/folder";
import { buildA000, type FileMeta, type RecordCounts } from "@/lib/uniform-structure/records";
import type { Business } from "@/lib/types";

// Fixed instants just after midnight in Israel, which are still "yesterday" in
// UTC and in any timezone west of it (this machine included).
const WINTER = new Date("2026-03-14T22:30:00Z"); // Israel UTC+2: 2026-03-15 00:30
const SUMMER = new Date("2026-07-31T21:30:00Z"); // Israel UTC+3: 2026-08-01 00:30
const NEW_YEAR = new Date("2026-12-31T22:30:00Z"); // Israel: 2027-01-01 00:30

describe("uniform dates are Israeli dates", () => {
  it("formats an instant as the Asia/Jerusalem calendar date and clock", () => {
    expect([formatDate(WINTER), formatTime(WINTER)]).toEqual(["20260315", "0030"]);
    expect([formatDate(SUMMER), formatTime(SUMMER)]).toEqual(["20260801", "0030"]);
    expect(israelClock(NEW_YEAR)).toEqual({ date: "2027-01-01", hh: "00", mm: "30" });
  });

  it("writes a stored YYYY-MM-DD date as it is, never shifted by a timezone", () => {
    expect(formatDate("2026-01-01")).toBe("20260101");
    expect(formatDate("2026-12-31")).toBe("20261231");
    expect(formatDate("2026-03-15T12:00:00")).toBe("20260315");
    expect(formatDate("2026-02-30")).toBe("00000000");
    expect(formatDate(undefined)).toBe("00000000");
  });

  it("A000 period and process dates, and the folder name, use Israeli time", () => {
    const business = { taxId: "512345679", name: "עסק", businessType: "authorized" } as unknown as Business;
    const meta = { business, taxYear: 2026, generatedAt: NEW_YEAR, softwareName: "t", softwareVersion: "1", softwareVendorName: "v", softwareVendorTaxId: "049040686", softwareRegistrationNumber: "", fromDate: "2026-01-01", toDate: "2026-12-31" } as unknown as FileMeta;
    const counts: RecordCounts = { total: 2, c100: 0, d110: 0, d120: 0, b100: 0, b110: 0, m100: 0 };
    const line = buildA000(meta, counts);
    expect(line.slice(366, 374)).toBe("20260101"); // 1024
    expect(line.slice(374, 382)).toBe("20261231"); // 1025
    expect(line.slice(382, 390)).toBe("20270101"); // 1026
    expect(line.slice(390, 394)).toBe("0030"); // 1027
    expect(uniformFolderPath("512345679", NEW_YEAR)).toBe("OPENFRMT/51234567.27/01010030");
  });
});

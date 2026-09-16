import { describe, it, expect } from "vitest";
import {
  applicableObligations,
  daysUntil,
  DEFAULT_FILING_PREFERENCES,
  obligationOccurrences,
  OBLIGATIONS,
  OFFICIAL_DEADLINES,
  periodicDeadline,
  relativeDayLabel,
  shiftOffRestDay,
} from "@/lib/ita/filing-calendar";

const prefs = DEFAULT_FILING_PREFERENCES;
/** The two long dash characters the house style bans, built from code points. */
const LONG_DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe("official 2026 deadlines (Tax Authority notice pa151025-2)", () => {
  it("holds the twelve published rows exactly", () => {
    // Copied from the notice as read on 2026-09-15; a change here must come from a new notice.
    expect(OFFICIAL_DEADLINES["2026-03"]).toEqual({ periodic: "2026-04-27", withholding: "2026-04-27", detailed: "2026-04-27" });
    expect(OFFICIAL_DEADLINES["2026-08"]).toEqual({ periodic: "2026-09-24", withholding: "2026-09-24", detailed: "2026-09-24" });
    expect(OFFICIAL_DEADLINES["2026-09"]).toEqual({ periodic: "2026-10-19", withholding: "2026-10-19", detailed: "2026-10-26" });
    expect(OFFICIAL_DEADLINES["2026-12"]).toEqual({ periodic: "2027-01-18", withholding: "2027-01-18", detailed: "2027-01-26" });
    expect(Object.keys(OFFICIAL_DEADLINES)).toHaveLength(12);
  });

  it("a bi-monthly period is due with its last month's row", () => {
    // July-August 2026: Yom Kippur moved it to 24.9, later than the online 19th.
    expect(periodicDeadline("periodic", "2026-08")).toEqual({ date: "2026-09-24", onlineDate: "2026-09-24", official: true });
  });

  it("online filing and payment runs to the 19th when the table date is earlier", () => {
    expect(periodicDeadline("periodic", "2026-10")).toEqual({ date: "2026-11-16", onlineDate: "2026-11-19", official: true });
    expect(periodicDeadline("periodic", "2026-05")).toEqual({ date: "2026-06-15", onlineDate: "2026-06-19", official: true });
  });

  it("the detailed report and deductions have no online extension", () => {
    expect(periodicDeadline("detailed", "2026-10")).toEqual({ date: "2026-11-23", official: true });
    expect(periodicDeadline("withholding", "2026-05")).toEqual({ date: "2026-06-16", official: true });
  });
});

describe("months without a published table", () => {
  it("moves a Friday, Saturday or Sunday to Monday", () => {
    expect(shiftOffRestDay("2027-05-14")).toBe("2027-05-17"); // Friday
    expect(shiftOffRestDay("2027-05-15")).toBe("2027-05-17"); // Saturday
    expect(shiftOffRestDay("2027-05-16")).toBe("2027-05-17"); // Sunday
    expect(shiftOffRestDay("2027-05-18")).toBe("2027-05-18"); // Tuesday stays
  });

  it("falls back to the statutory day and marks it unofficial", () => {
    // April 2027 report: 15.5.2027 is a Saturday.
    expect(periodicDeadline("periodic", "2027-04")).toEqual({ date: "2027-05-17", onlineDate: "2027-05-19", official: false });
    expect(periodicDeadline("detailed", "2027-04")).toEqual({ date: "2027-05-24", official: false }); // 23.5.2027 is a Sunday
  });
});

describe("which obligations apply", () => {
  it("an עוסק מורשה files VAT, an עוסק פטור files the annual declaration instead", () => {
    expect(applicableObligations("authorized", prefs)).toEqual(["vat_periodic", "income_tax_advance", "btl_advance", "annual_report", "pension_deposit"]);
    expect(applicableObligations("exempt", prefs)).toEqual(["exempt_declaration", "income_tax_advance", "btl_advance", "annual_report", "pension_deposit"]);
  });

  it("a company gets VAT, advances and deductions, not the self-employed obligations", () => {
    expect(applicableObligations("company", { ...prefs, hasEmployees: true })).toEqual(["vat_periodic", "income_tax_advance", "withholding"]);
  });

  it("detailed reporting and deductions are opt-in", () => {
    const ids = applicableObligations("authorized", { ...prefs, detailedReporter: true, hasEmployees: true });
    expect(ids).toContain("vat_detailed");
    expect(ids).toContain("withholding");
    // An exempt dealer never gets the detailed VAT report, even if the flag is on.
    expect(applicableObligations("exempt", { ...prefs, detailedReporter: true })).not.toContain("vat_detailed");
  });

  it("every obligation has an https official link, all five explanations and no long dashes", () => {
    for (const o of Object.values(OBLIGATIONS)) {
      expect(o.whereUrl, o.id).toMatch(/^https:\/\//);
      for (const field of [o.title, o.who, o.what, o.when, o.how, o.whereLabel]) expect(field.length, o.id).toBeGreaterThan(3);
      expect(LONG_DASHES.test(`${o.title}${o.who}${o.what}${o.when}${o.how}`), o.id).toBe(false);
    }
  });

  it("every 'who' line says where an exempt dealer stands", () => {
    for (const o of Object.values(OBLIGATIONS)) {
      expect(o.who, o.id).toMatch(/עוסק פטור|כל עצמאי|כולם/);
    }
  });
});

describe("obligationOccurrences", () => {
  it("lists the autumn 2026 deadlines of a bi-monthly עוסק מורשה in date order", () => {
    const occ = obligationOccurrences("authorized", prefs, "2026-09-15", "2026-10-31");
    expect(occ.map((o) => [o.key, o.date])).toEqual([
      ["btl_advance:2026-08", "2026-09-15"],
      ["income_tax_advance:2026-B4", "2026-09-24"],
      ["vat_periodic:2026-B4", "2026-09-24"],
      ["btl_advance:2026-09", "2026-10-15"],
    ]);
    expect(occ.find((o) => o.id === "vat_periodic")?.periodLabel).toBe("יולי-אוגוסט 2026");
  });

  it("a monthly filer gets every month, labelled by the month", () => {
    const occ = obligationOccurrences("authorized", { ...prefs, vatCadence: "monthly" }, "2026-10-01", "2026-10-31");
    const vat = occ.filter((o) => o.id === "vat_periodic");
    expect(vat.map((o) => [o.date, o.periodLabel])).toEqual([["2026-10-19", "ספטמבר 2026"]]);
  });

  it("includes the yearly deadlines, and a January deadline for last year", () => {
    const occ = obligationOccurrences("exempt", prefs, "2026-12-01", "2027-05-01");
    const keys = occ.map((o) => o.key);
    expect(keys).toContain("pension_deposit:2026");
    expect(keys).toContain("exempt_declaration:2026");
    expect(keys).toContain("annual_report:2026");
    expect(occ.find((o) => o.key === "exempt_declaration:2026")?.date).toBe("2027-01-31");
    expect(occ.find((o) => o.key === "annual_report:2026")?.date).toBe("2027-04-30");
    expect(keys.some((k) => k.startsWith("vat_periodic"))).toBe(false);
  });

  it("keys are unique so a filed mark never covers two deadlines", () => {
    const occ = obligationOccurrences("authorized", { ...prefs, detailedReporter: true, hasEmployees: true, advanceCadence: "monthly" }, "2026-01-01", "2027-12-31");
    expect(new Set(occ.map((o) => o.key)).size).toBe(occ.length);
  });
});

describe("day labels", () => {
  it("counts whole days across month and year ends", () => {
    expect(daysUntil("2026-10-01", "2026-09-30")).toBe(1);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
    expect(relativeDayLabel("2026-09-15", "2026-09-15")).toBe("היום");
    expect(relativeDayLabel("2026-09-16", "2026-09-15")).toBe("מחר");
    expect(relativeDayLabel("2026-09-24", "2026-09-15")).toBe("בעוד 9 ימים");
    expect(relativeDayLabel("2026-09-12", "2026-09-15")).toBe("לפני 3 ימים");
  });
});

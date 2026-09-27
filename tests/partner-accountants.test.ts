import { describe, it, expect } from "vitest";
import { PARTNER_ACCOUNTANTS, hasPartnerAccountants } from "@/lib/partner-accountants";

// The two long dashes (en dash 0x2013, em dash 0x2014), built from their code
// points so this file itself never contains either character.
const LONG_DASHES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
const hasLongDash = (s: string) => LONG_DASHES.some((d) => s.includes(d));

describe("PARTNER_ACCOUNTANTS", () => {
  it("every entry has the required fields filled", () => {
    for (const a of PARTNER_ACCOUNTANTS) {
      expect(a.slug.trim(), `slug of ${a.name}`).not.toBe("");
      expect(a.name.trim(), `name of ${a.slug}`).not.toBe("");
      expect(a.city.trim(), `city of ${a.slug}`).not.toBe("");
      expect(a.joinedOn.trim(), `joinedOn of ${a.slug}`).not.toBe("");
    }
  });

  it("slugs are unique", () => {
    const slugs = PARTNER_ACCOUNTANTS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("joinedOn is yyyy-mm-dd", () => {
    for (const a of PARTNER_ACCOUNTANTS) {
      expect(a.joinedOn, a.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("no string field contains a long dash", () => {
    for (const a of PARTNER_ACCOUNTANTS) {
      const strings: string[] = [];
      for (const v of Object.values(a)) {
        if (typeof v === "string") strings.push(v);
        else if (Array.isArray(v)) strings.push(...v.filter((x): x is string => typeof x === "string"));
      }
      for (const s of strings) {
        expect(hasLongDash(s), `${a.slug}: "${s}"`).toBe(false);
      }
    }
  });

  it("the long-dash check itself catches both characters", () => {
    expect(hasLongDash(`a${LONG_DASHES[0]}b`)).toBe(true);
    expect(hasLongDash(`a${LONG_DASHES[1]}b`)).toBe(true);
    expect(hasLongDash("a-b")).toBe(false);
  });

  it("hasPartnerAccountants() matches the list length", () => {
    expect(hasPartnerAccountants()).toBe(PARTNER_ACCOUNTANTS.length > 0);
  });
});
